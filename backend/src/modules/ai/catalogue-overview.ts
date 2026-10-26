import { systemClient } from '../supabase/supabase.service.js';
import { priceLabel } from './money.js';
import type { CatalogueOverviewKind } from './history-aware.js';
import { hcmWards } from './hcm-wards.js';

export type OverviewRow = { label?: string; count?: number | string; property_type?: string; transaction_type?: string; min_price?: number | string | null; max_price?: number | string | null };
type Overview = { areas: OverviewRow[]; types: OverviewRow[]; projects: OverviewRow[]; prices: OverviewRow[] };
export type GroupedArea = { label: string; count: number; min_price: number | null; max_price: number | null };
const cache = new Map<string, { expires: number; value: Overview }>();
const ttl = 5 * 60 * 1000;
export const typeLabels: Record<string, string> = { Apartment: 'Căn hộ chung cư', House: 'Nhà phố', Land: 'Đất nền', Villa: 'Biệt thự', Office: 'Văn phòng', Shop: 'Mặt bằng' };
const getRows = (value: unknown): OverviewRow[] => Array.isArray(value) ? value.filter((row): row is OverviewRow => !!row && typeof row === 'object') : [];
const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLocaleLowerCase('vi');
const cleanArea = (value: string) => {
  const parts = value.normalize('NFC').trim().split(',').map(part => part.trim()).filter(Boolean);
  const tail = parts.at(-1) || '';
  return parts.length > 1 && /^(?:thanh pho ho chi minh|tp\.?\s*hcm|tp\.?\s*ho chi minh)$/iu.test(fold(tail)) ? parts.slice(0, -1).join(', ') : parts.join(', ');
};

function areaGroupLabel(value: string) {
  const clean = cleanArea(value);
  const ascii = fold(clean);
  if (/ba ria|vung tau/.test(ascii)) return 'Vũng Tàu';
  if (/binh duong/.test(ascii)) return 'Bình Dương';
  const explicit = clean.match(/^(?:Quận|Huyện)\s+[^,]+/iu)?.[0]?.trim();
  if (explicit) return /quận\s+[29]$/iu.test(explicit) ? 'Thủ Đức' : explicit;
  if (fold(clean) === 'thu duc') return 'Thủ Đức';
  const ward = clean.match(/^(?:Phường|Xã)\s+([^,]+)/iu)?.[1]?.trim() || clean;
  const mapped = hcmWards.find(row => fold(row.ward) === fold(ward));
  if (!mapped) return clean;
  const district = mapped.formerDistricts[0] || clean;
  return /quận\s+[29]$|^thủ đức$/iu.test(district) ? 'Thủ Đức' : district;
}

/** Merge the ward-level RPC labels into the former-district labels customers search for. */
export function groupAreaRows(rows: OverviewRow[]): GroupedArea[] {
  const grouped = new Map<string, GroupedArea>();
  for (const row of rows) {
    const label = areaGroupLabel(String(row.label || 'Chưa rõ'));
    const count = Number(row.count) || 0;
    const min = row.min_price == null ? null : Number(row.min_price);
    const max = row.max_price == null ? null : Number(row.max_price);
    const current = grouped.get(label);
    if (!current) grouped.set(label, { label, count, min_price: Number.isFinite(min as number) ? min : null, max_price: Number.isFinite(max as number) ? max : null });
    else {
      current.count += count;
      if (min != null && Number.isFinite(min)) current.min_price = current.min_price == null ? min : Math.min(current.min_price, min);
      if (max != null && Number.isFinite(max)) current.max_price = current.max_price == null ? max : Math.max(current.max_price, max);
    }
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'vi'));
}

function filteredTypes(data: Overview, transactionType?: 'Sale' | 'Rent') {
  return data.types.filter(row => !transactionType || row.transaction_type === transactionType);
}

export async function catalogueOverview(kind: CatalogueOverviewKind, transactionType?: 'Sale' | 'Rent', maxPrice?: number, propertyType?: string) {
  const key = `${transactionType || 'all'}:${maxPrice ?? 'all'}:${propertyType || 'all'}`;
  let value = cache.get(key)?.value;
  if (!value || cache.get(key)!.expires <= Date.now()) {
    const result = await systemClient().rpc('pose_system_ai_catalogue_overview', { p_transaction_type: transactionType || null, p_max_price: maxPrice ?? null, p_property_type: propertyType || null });
    if (result.error) throw new Error(result.error.message || 'CATALOGUE_OVERVIEW_UNAVAILABLE');
    const raw = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
    value = { areas: getRows(raw.areas), types: getRows(raw.types), projects: getRows(raw.projects), prices: getRows(raw.prices) };
    cache.set(key, { expires: Date.now() + ttl, value });
  }
  return formatOverview(kind, value, transactionType, maxPrice);
}

function formatOverview(kind: CatalogueOverviewKind, data: Overview, transactionType?: 'Sale' | 'Rent', maxPrice?: number) {
  if (kind === 'areas') {
    const groupedAreas = groupAreaRows(data.areas);
    const top = groupedAreas.slice(0, 8);
    const rest = Math.max(0, groupedAreas.length - top.length);
    const monthly = transactionType === 'Rent';
    if (maxPrice !== undefined) {
      const areaLabels = top.map(row => `${row.label} (${row.count} tin${row.min_price != null && row.max_price != null ? `, ${priceLabel(row.min_price, monthly)}\u2013${priceLabel(row.max_price, monthly)}` : ''})`);
      const types = filteredTypes(data, transactionType).slice(0, 6).map(row => `${typeLabels[row.property_type || ''] || row.property_type || '\u0042ất động sản'} (${Number(row.count) || 0})`);
      const budget = priceLabel(maxPrice, monthly);
      const reply = top.length
        ? `Với ngân sách tối đa ${budget}, bạn có thể cân nhắc: ${areaLabels.join(', ')}${rest ? ` và ${rest} khu khác` : ''}.\nTrong dữ liệu hiện có, ngân sách này có tin: ${types.join(', ') || 'chưa đủ dữ liệu'}.\nBạn muốn xem kỹ khu nào?`
        : `Hiện chưa có tin ${transactionType === 'Rent' ? 'cho thuê' : 'bán'} nào trong danh mục công bố có giá không vượt ${budget}. Bạn muốn xem kỹ khu nào?`;
      return { reply, options: top.slice(0, 3).map(row => row.label).concat('Chưa rõ, gợi ý giúp tôi').slice(0, 4), areas: top, types: filteredTypes(data, transactionType) };
    }
    const labels = top.map(row => `${row.label} (${row.count})`);
    return { reply: `Hiện TERAVA có tin đăng tại ${labels.join(', ')}${rest ? ` và ${rest} khu khác` : ''}. Bạn muốn xem bất động sản ở khu vực nào?`, options: top.slice(0, 3).map(row => row.label).concat('Chưa rõ, gợi ý giúp tôi').slice(0, 4), areas: top, types: filteredTypes(data, transactionType) };
  }
  if (kind === 'projects') {
    const labels = data.projects.slice(0, 12).map(row => `${row.label} (${Number(row.count) || 0})`);
    return { reply: labels.length ? `Các dự án hiện có tin đăng: ${labels.join(', ')}. Bạn muốn xem dự án nào?` : 'Hiện chưa có dự án nào có tin đăng được công bố. Bạn muốn mình gợi ý theo khu vực nào?', options: data.projects.slice(0, 3).map(row => String(row.label)).concat('Chưa rõ, gợi ý giúp tôi').slice(0, 4) };
  }
  if (kind === 'prices') {
    const rows = data.prices.slice(0, 8);
    const labels = rows.map(row => `${typeLabels[row.property_type || ''] || row.property_type || 'Bất động sản'}: ${priceLabel(Number(row.min_price), row.transaction_type === 'Rent')}\u2013${priceLabel(Number(row.max_price), row.transaction_type === 'Rent')}`);
    return { reply: labels.length ? `Mức giá tham khảo theo tin đang có: ${labels.join('; ')}. Bạn quan tâm loại nào?` : 'Hiện chưa có đủ dữ liệu giá để tổng hợp. Bạn quan tâm loại nào?', options: rows.slice(0, 3).map(row => typeLabels[row.property_type || ''] || String(row.property_type)).concat('Chưa rõ, gợi ý giúp tôi').slice(0, 4) };
  }
  const byType = filteredTypes(data, transactionType);
  const grouped = new Map<string, string[]>();
  for (const row of byType) { const list = grouped.get(row.transaction_type || 'Sale') || []; list.push(`${typeLabels[row.property_type || ''] || row.property_type} (${Number(row.count) || 0})`); grouped.set(row.transaction_type || 'Sale', list); }
  const sections = [...grouped.entries()].map(([type, labels]) => `${type === 'Rent' ? 'Cho thuê' : 'Đang bán'}: ${labels.join(', ')}`);
  const types = [...new Set(byType.map(row => typeLabels[row.property_type || ''] || String(row.property_type)))];
  return { reply: `${sections.join('. ')}. Bạn quan tâm loại nào?`, options: types.slice(0, 3).concat('Chưa rõ, gợi ý giúp tôi').slice(0, 4) };
}
