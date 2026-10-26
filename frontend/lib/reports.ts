import type { LeadStatus, Temperature } from './leads';
export const reportPeriods = { today: 'Hôm nay', last7: '7 ngày gần nhất', month: 'Tháng này', previous_month: 'Tháng trước', custom: 'Khoảng ngày tùy chọn' };
export type ReportPeriod = keyof typeof reportPeriods;
export type ReportFilters = { period: ReportPeriod; date_from: string; date_to: string; status: string; temperature: string; archived: 'all' | 'true' | 'false'; sales_id: string };
export type LeadReport = {
  stats: { total: number; converted: number; unassigned?: number };
  statuses: { key: LeadStatus; count: number }[];
  temperatures: { key: Temperature | 'UNRATED'; count: number }[];
  trend: { date: string; count: number }[];
  bucket: 'day' | 'month'; timezone: 'Asia/Ho_Chi_Minh'; generated_at: string;
  filters: { date_from: string; date_to: string; status?: string; temperature?: string; archived: string; sales_id?: string };
  scope: { role: 'Admin' | 'Sales' };
};
export type ReportOptions = { role: 'Admin' | 'Sales'; sales: { id: string; name: string; active: boolean }[] };
export function vietnamToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (key: string) => parts.find(p => p.type === key)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function shift(date: string, days: number) { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function reportRange(period: Exclude<ReportPeriod, 'custom'>, today = vietnamToday()) {
  const month = today.slice(0, 8) + '01';
  if (period === 'today') return { date_from: today, date_to: today };
  if (period === 'last7') return { date_from: shift(today, -6), date_to: today };
  if (period === 'previous_month') { const end = shift(month, -1); return { date_from: end.slice(0, 8) + '01', date_to: end }; }
  return { date_from: month, date_to: today };
}
export function initialReportFilters(today: string): ReportFilters {
  return { period: 'month', ...reportRange('month', today), status: '', temperature: '', archived: 'all', sales_id: '' };
}
export function resolvedReportFilters(filters: ReportFilters, today: string): ReportFilters {
  return filters.period === 'custom' ? filters : { ...filters, ...reportRange(filters.period, today) };
}
export function reportRangeError(from: string, to: string, today: string) {
  const valid = (v: string) => /^[1-9]\d{3}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
  if (!valid(from) || !valid(to)) return 'Chọn đủ ngày bắt đầu và kết thúc hợp lệ.';
  if (from > to) return 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.';
  if (to > today) return 'Chọn khoảng ngày đến hôm nay.';
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 3660) return 'Chọn khoảng thời gian không quá 10 năm.';
  return '';
}
export function reportParams(filters: ReportFilters, role: 'Admin' | 'Sales') {
  return new URLSearchParams({ date_from: filters.date_from, date_to: filters.date_to, archived: filters.archived,
    ...(filters.status ? { status: filters.status } : {}), ...(filters.temperature ? { temperature: filters.temperature } : {}),
    ...(role === 'Admin' && filters.sales_id ? { sales_id: filters.sales_id } : {}) });
}
export function reportDate(date: string, monthOnly = false) {
  return new Date(date + 'T00:00:00+07:00').toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', ...(monthOnly ? {} : { day: '2-digit' }), month: '2-digit', year: 'numeric' });
}
