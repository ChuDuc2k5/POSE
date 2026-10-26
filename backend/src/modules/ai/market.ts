import { authClient } from '../auth/session.js';
import { priceLabel } from './money.js';
import { withFormerDistrict } from './ward-label.js';

type Row = { location: string | null; price: number | string | null; area: number | string | null; property_type: string; transaction_type: 'Sale' | 'Rent'; name: string };

// "Tài chính 5 tỷ nên tìm ở khu vực nào?", "giá thuê trung bình khu này", "giá đất bao nhiêu một m²".
export const areaAdviceQuestion = (text: string) => /(?:khu vực|quận|chỗ|nơi) nào|nên (?:tìm|mua|thuê|chọn) ở đâu|ở đâu (?:thì )?(?:hợp|phù hợp)/iu.test(text);
export const rentLevelQuestion = (text: string) => /giá thuê (?:trung bình|bình quân|khoảng bao nhiêu|bao nhiêu)|cho thuê (?:được|lại được)? ?(?:khoảng )?bao nhiêu|để cho thuê/iu.test(text);
export const landPriceQuestion = (text: string) => /giá (?:đất|nhà|căn hộ)?\s*(?:khu vực|ở đây|khu này|quanh đây)|bao nhiêu (?:tiền )?(?:một|1|mỗi) (?:mét vuông|m2|m²)/iu.test(text);

const district = (location: string) => withFormerDistrict(location).match(/\(([^)]+?) cũ\)/u)?.[1] || withFormerDistrict(location).match(/(?:Quận|Huyện)\s+[\p{L}\d ]+?(?=,|$)/u)?.[0] || '';
const ward = (location: string) => location.match(/(?:Phường|Xã)\s+[^,]+/u)?.[0] || '';
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };

async function rows(filters: { transaction_type: 'Sale' | 'Rent'; type?: string; maxPrice?: number; place?: string }): Promise<Row[]> {
  let query = authClient().from('property_public_catalog').select('location,price,area,property_type,transaction_type,name').eq('transaction_type', filters.transaction_type).eq('availability', 'Available').not('price', 'is', null);
  if (filters.type) query = query.eq('property_type', filters.type);
  if (filters.maxPrice !== undefined) query = query.lte('price', filters.maxPrice * 1.05);
  if (filters.place) query = query.ilike('location', `%${filters.place.replace(/[%_\\]/g, '\\$&')}%`);
  const result = await query.limit(400);
  return result.error ? [] : (result.data || []) as Row[];
}

/** Districts that actually have listings within the budget, busiest first. */
export async function areaSummary(filters: { transaction_type: 'Sale' | 'Rent'; type?: string; maxPrice: number }): Promise<string> {
  const groups = new Map<string, number[]>();
  for (const row of await rows(filters)) { const name = district(row.location || ''); if (!name) continue; groups.set(name, [...(groups.get(name) || []), Number(row.price)]); }
  const monthly = filters.transaction_type === 'Rent';
  const top = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 4);
  if (!top.length) return '';
  return `Theo tin đăng trên TERAVA trong mức ${priceLabel(filters.maxPrice, monthly)}: ` + top.map(([name, prices]) => `${name} có ${prices.length} tin, giá từ ${priceLabel(Math.min(...prices), monthly)}`).join('; ') + '.';
}

/** Observed price level around one listing: rent range for "cho thuê được bao nhiêu", price per m² for land. */
export async function marketSummary(listing: { location?: string | null; property_type?: string; transaction_type?: string }, kind: 'rent' | 'per_m2'): Promise<string> {
  const place = ward(listing.location || '') || district(listing.location || '');
  if (!place) return '';
  if (kind === 'rent') {
    const prices = (await rows({ transaction_type: 'Rent', type: listing.property_type, place })).map(row => Number(row.price)).filter(value => value > 0);
    if (prices.length < 2) return '';
    return `Theo ${prices.length} tin cho thuê cùng loại ở ${place} trên TERAVA: giá thuê từ ${priceLabel(Math.min(...prices), true)} đến ${priceLabel(Math.max(...prices), true)}, phổ biến khoảng ${priceLabel(median(prices), true)}.`;
  }
  const perM2 = (await rows({ transaction_type: 'Sale', type: listing.property_type, place })).filter(row => Number(row.area) > 0).map(row => Math.round(Number(row.price) / Number(row.area) / 1e6) * 1e6);
  if (perM2.length < 2) return '';
  return `Theo ${perM2.length} tin bán cùng loại ở ${place} trên TERAVA: giá khoảng ${priceLabel(Math.min(...perM2), false)} đến ${priceLabel(Math.max(...perM2), false)} mỗi m², phổ biến khoảng ${priceLabel(median(perM2), false)} mỗi m².`;
}
