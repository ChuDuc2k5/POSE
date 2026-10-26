import { systemClient } from '../supabase/supabase.service.js';
import { priceLabel } from './money.js';
import type { CatalogueOverviewKind } from './history-aware.js';

type OverviewRow = { label?: string; count?: number | string; property_type?: string; transaction_type?: string; min_price?: number | string | null; max_price?: number | string | null };
type Overview = { areas: OverviewRow[]; types: OverviewRow[]; projects: OverviewRow[]; prices: OverviewRow[] };
const cache = new Map<string, { expires: number; value: Overview }>();
const ttl = 5 * 60 * 1000;

const typeLabels: Record<string, string> = { Apartment: 'Căn hộ chung cư', House: 'Nhà phố', Land: 'Đất nền', Villa: 'Biệt thự', Office: 'Văn phòng', Shop: 'Mặt bằng' };
const getRows = (value: unknown): OverviewRow[] => Array.isArray(value) ? value.filter((row): row is OverviewRow => !!row && typeof row === 'object') : [];

export async function catalogueOverview(kind: CatalogueOverviewKind, transactionType?: 'Sale' | 'Rent') {
  const key = transactionType || 'all';
  let value = cache.get(key)?.value;
  if (!value || cache.get(key)!.expires <= Date.now()) {
    const result = await systemClient().rpc('pose_system_ai_catalogue_overview', { p_transaction_type: transactionType || null });
    if (result.error) throw new Error(result.error.message || 'CATALOGUE_OVERVIEW_UNAVAILABLE');
    const raw = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
    value = { areas: getRows(raw.areas), types: getRows(raw.types), projects: getRows(raw.projects), prices: getRows(raw.prices) };
    cache.set(key, { expires: Date.now() + ttl, value });
  }
  return formatOverview(kind, value, transactionType);
}

function formatOverview(kind: CatalogueOverviewKind, data: Overview, transactionType?: 'Sale' | 'Rent') {
  if (kind === 'areas') {
    const top = data.areas.slice(0, 8);
    const rest = Math.max(0, data.areas.length - top.length);
    const labels = top.map(row => `${row.label} (${Number(row.count) || 0})`);
    return { reply: `Hiện TERAVA có tin đăng tại ${labels.join(', ')}${rest ? ` và ${rest} khu khác` : ''}. Bạn muốn xem bất động sản ở khu vực nào?`, options: top.slice(0, 3).map(row => String(row.label)).concat('Chưa rõ, gợi ý giúp tôi').slice(0, 4) };
  }
  if (kind === 'projects') {
    const labels = data.projects.slice(0, 12).map(row => `${row.label} (${Number(row.count) || 0})`);
    return { reply: labels.length ? `Các dự án hiện có tin đăng: ${labels.join(', ')}. Bạn muốn xem dự án nào?` : 'Hiện chưa có dự án nào có tin đăng được công bố. Bạn muốn mình gợi ý theo khu vực nào?', options: data.projects.slice(0, 3).map(row => String(row.label)).concat('Chưa rõ, gợi ý giúp tôi').slice(0, 4) };
  }
  if (kind === 'prices') {
    const rows = data.prices.slice(0, 8);
    const labels = rows.map(row => `${typeLabels[row.property_type || ''] || row.property_type || 'Bất động sản'}: ${priceLabel(Number(row.min_price), row.transaction_type === 'Rent')}–${priceLabel(Number(row.max_price), row.transaction_type === 'Rent')}`);
    return { reply: labels.length ? `Mức giá tham khảo theo tin đang có: ${labels.join('; ')}. Bạn quan tâm loại nào?` : 'Hiện chưa có đủ dữ liệu giá để tổng hợp. Bạn quan tâm loại nào?', options: rows.slice(0, 3).map(row => typeLabels[row.property_type || ''] || String(row.property_type)).concat('Chưa rõ, gợi ý giúp tôi').slice(0, 4) };
  }
  const byType = data.types.filter(row => !transactionType || row.transaction_type === transactionType);
  const grouped = new Map<string, string[]>();
  for (const row of byType) { const list = grouped.get(row.transaction_type || 'Sale') || []; list.push(`${typeLabels[row.property_type || ''] || row.property_type} (${Number(row.count) || 0})`); grouped.set(row.transaction_type || 'Sale', list); }
  const sections = [...grouped.entries()].map(([type, labels]) => `${type === 'Rent' ? 'Cho thuê' : 'Đang bán'}: ${labels.join(', ')}`);
  const types = [...new Set(byType.map(row => typeLabels[row.property_type || ''] || String(row.property_type)))];
  return { reply: `${sections.join('. ')}. Bạn quan tâm loại nào?`, options: types.slice(0, 3).concat('Chưa rõ, gợi ý giúp tôi').slice(0, 4) };
}
