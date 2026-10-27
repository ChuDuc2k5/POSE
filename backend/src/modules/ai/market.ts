import { authClient } from '../auth/session.js';
import { priceLabel } from './money.js';
import { withFormerDistrict } from './ward-label.js';
import { catalogueOverview } from './catalogue-overview.js';

type Row = { location: string | null; price: number | string | null; area: number | string | null; property_type: string; transaction_type: 'Sale' | 'Rent'; name: string };

// "Tài chính 5 tỷ nên tìm ở khu vực nào?", "giá thuê trung bình khu này", "giá đất bao nhiêu một m²".
export const areaAdviceQuestion = (text: string) => /(?:khu vực|quận|chỗ|nơi) nào|nên\s+(?:tìm|mua|thuê|chọn)(?:[^?\n]{0,80})?(?:ở đâu|khu nào|đâu phù hợp)|(?:mua|thuê)(?:[^?\n]{0,80})?(?:mua được ở đâu|thuê được ở đâu|ở đâu|khu nào|đâu phù hợp)|với[^?\n]{0,80}(?:mua được gì|thuê được gì)/iu.test(text);
export const rentLevelQuestion = (text: string) => /giá thuê (?:trung bình|bình quân|khoảng bao nhiêu|bao nhiêu)|cho thuê (?:được|lại được)? ?(?:khoảng )?bao nhiêu|để cho thuê/iu.test(text);
export const landPriceQuestion = (text: string) => /giá (?:đất|nhà|căn hộ)?\s*(?:khu vực|ở đây|khu này|quanh đây)|bao nhiêu (?:tiền )?(?:một|1|mỗi) (?:mét vuông|m2|m²)/iu.test(text);
export const priceComparisonQuestion = (text: string) => /so với|cao không|đắt không|rẻ không|cao hơn|rẻ hơn/iu.test(text);

const district = (location: string) => withFormerDistrict(location).match(/\(([^)]+?) cũ\)/u)?.[1] || withFormerDistrict(location).match(/(?:Quận|Huyện)\s+[\p{L}\d ]+?(?=,|$)/u)?.[0] || '';
const ward = (location: string) => location.match(/(?:Phường|Xã)\s+[^,]+/u)?.[0] || '';
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };

async function rows(filters: { transaction_type: 'Sale' | 'Rent'; type?: string; maxPrice?: number; place?: string; area?: number }): Promise<Row[]> {
  let query = authClient().from('property_public_catalog').select('location,price,area,property_type,transaction_type,name').eq('transaction_type', filters.transaction_type).eq('availability', 'Available').not('price', 'is', null);
  if (filters.type) query = query.eq('property_type', filters.type);
  if (filters.maxPrice !== undefined) query = query.lte('price', filters.maxPrice * 1.05);
  if (filters.place) query = query.ilike('location', `%${filters.place.replace(/[%_\\]/g, '\\$&')}%`);
  if (typeof filters.area === 'number' && filters.area > 0) {
    query = query.gte('area', filters.area * 0.8).lte('area', filters.area * 1.2);
  }
  const result = await query.limit(400);
  return result.error ? [] : (result.data || []).filter(row => {
    const price=Number(row.price);
    return Number.isFinite(price) && price >= (row.transaction_type === 'Rent' ? 500_000 : 50_000_000);
  }) as Row[];
}

/** Reuse the catalogue overview aggregate for budgeted area advice. */
export async function areaSummary(filters: { transaction_type: 'Sale' | 'Rent'; type?: string; types?: string[]; maxPrice: number }): Promise<string> {
  const overview = await catalogueOverview('areas', filters.transaction_type, filters.maxPrice, filters.type || filters.types);
  return overview.reply;
}

/** Observed price level around one listing: rent range for "cho thuê được bao nhiêu", price per m² for land. */
export async function marketSummary(listing: { location?: string | null; property_type?: string; transaction_type?: string; area?: number | null }, kind: 'rent' | 'per_m2'): Promise<string> {
  const place = ward(listing.location || '') || district(listing.location || '');
  if (!place) return '';
  if (kind === 'rent') {
    const prices = (await rows({ transaction_type: 'Rent', type: listing.property_type, area: listing.area ?? undefined, place })).map(row => Number(row.price)).filter(value => value > 0);
    if (prices.length < 2) return '';
    return `Theo ${prices.length} tin cho thuê cùng loại ở ${place} trên TERAVA: giá thuê từ ${priceLabel(Math.min(...prices), true)} đến ${priceLabel(Math.max(...prices), true)}, phổ biến khoảng ${priceLabel(median(prices), true)}.`;
  }
  const perM2 = (await rows({ transaction_type: 'Sale', type: listing.property_type, place })).filter(row => Number(row.area) > 0).map(row => Math.round(Number(row.price) / Number(row.area) / 1e6) * 1e6);
  if (perM2.length < 2) return '';
  return `Theo ${perM2.length} tin bán cùng loại ở ${place} trên TERAVA: giá khoảng ${priceLabel(Math.min(...perM2), false)} đến ${priceLabel(Math.max(...perM2), false)} mỗi m², phổ biến khoảng ${priceLabel(median(perM2), false)} mỗi m².`;
}
