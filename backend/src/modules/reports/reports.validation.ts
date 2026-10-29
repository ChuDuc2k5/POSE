import { uuidPattern } from '../../common/catalog.js';
const statuses = ['NEW', 'CONTACTED', 'QUALIFIED', 'FOLLOW_UP', 'CONVERTED', 'LOST'];
export function reportToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
const validDate = (v: string) =>
  /^[1-9]\d{3}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v + 'T00:00:00Z')) &&
  new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
export function reportQuery(params: URLSearchParams, today = reportToday()) {
  const fields: Record<string, string> = {},
    filters: Record<string, string> = {};
  const allowed = ['date_from', 'date_to', 'status', 'temperature', 'archived', 'sales_id'];
  for (const [key, value] of params) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) fields.form = 'Bộ lọc không hợp lệ.';
    else if (value.trim()) filters[key] = value.trim();
  }
  if (
    params.has('date_from') !== params.has('date_to') ||
    (params.has('date_from') && (!filters.date_from || !filters.date_to))
  )
    fields.date = 'Chọn đủ ngày bắt đầu và kết thúc.';
  if (!params.has('date_from') && !params.has('date_to')) {
    filters.date_from = today.slice(0, 8) + '01';
    filters.date_to = today;
  }
  if (!validDate(filters.date_from || '') || !validDate(filters.date_to || '')) fields.date = 'Ngày không hợp lệ.';
  else if (
    filters.date_from > filters.date_to ||
    filters.date_to > today ||
    (Date.parse(filters.date_to) - Date.parse(filters.date_from)) / 86400000 > 3660
  )
    fields.date = 'Chọn khoảng ngày đến hôm nay và không quá 10 năm.';
  if (filters.status && !statuses.includes(filters.status)) fields.status = 'Trạng thái Lead không hợp lệ.';
  if (filters.temperature && !['HOT', 'WARM', 'COLD', 'UNRATED'].includes(filters.temperature))
    fields.temperature = 'Mức tiềm năng không hợp lệ.';
  filters.archived ||= 'all';
  if (!['all', 'true', 'false'].includes(filters.archived)) fields.archived = 'Bộ lọc lưu trữ không hợp lệ.';
  if (filters.sales_id && !uuidPattern.test(filters.sales_id)) fields.sales_id = 'Sales không hợp lệ.';
  return { filters, fields };
}
