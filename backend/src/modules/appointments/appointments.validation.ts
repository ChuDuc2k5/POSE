import { uuidPattern } from '../../common/catalog.js';
export const appointmentStatuses = ['SCHEDULED', 'COMPLETED', 'CANCELLED'];
export const appointmentChannels = ['Phone', 'Online', 'InPerson'];
const id = (v: unknown) => typeof v === 'string' && uuidPattern.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, min: number, max: number) => typeof v === 'string' && v.trim().length >= min && v.length <= max;
const date = (v: string) => /^[1-9]\d{3}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const instant = (v: unknown) => {
  if (typeof v !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) || !date(v.slice(0, 10))) return false;
  return Number.isFinite(Date.parse(v));
};
export function appointmentQuery(params: URLSearchParams, lookup = false) {
  const fields: Record<string, string> = {}, filters: Record<string, string> = {};
  const allowed = lookup ? ['kind', 'q', 'lead_id', 'page'] : ['q', 'status', 'sales_id', 'lead_id', 'date_from', 'date_to', 'page', 'pageSize'];
  for (const [k, v] of params) {
    if (!allowed.includes(k) || params.getAll(k).length > 1) fields.form = 'Bộ lọc không hợp lệ.';
    else if (v.trim() && !['page', 'pageSize'].includes(k)) filters[k] = v.trim();
  }
  const page = Number(params.get('page') || 1), pageSize = Number(params.get('pageSize') || 12);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) fields.page = 'Trang không hợp lệ.';
  if ((filters.q || '').length > 120) fields.q = 'Từ khóa tối đa 120 ký tự.';
  for (const k of ['lead_id', 'sales_id']) if (filters[k] && !id(filters[k])) fields[k] = 'Mã không hợp lệ.';
  if (filters.status && !appointmentStatuses.includes(filters.status)) fields.status = 'Trạng thái không hợp lệ.';
  for (const k of ['date_from', 'date_to']) if (filters[k] && !date(filters[k])) fields[k] = 'Ngày không hợp lệ.';
  if (filters.date_from && filters.date_to && filters.date_from > filters.date_to) fields.date = 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.';
  if (lookup && (!['leads', 'properties', 'sales'].includes(filters.kind) || filters.kind === 'properties' && !filters.lead_id)) fields.kind = 'Chọn danh mục và Lead hợp lệ.';
  return { filters, page, pageSize, fields };
}
export function validateAppointment(input: Record<string, unknown>, create = false, role: 'Admin' | 'Sales' = 'Sales') {
  const fields: Record<string, string> = {}, action = create ? 'create' : input.action;
  if (Object.keys(input).some(k => !['action', 'data', 'reason', 'version'].includes(k))) fields.form = 'Dữ liệu chứa trường không được phép.';
  if (create && input.action !== undefined && input.action !== 'create' || create && input.version !== undefined) fields.action = 'Yêu cầu tạo lịch không hợp lệ.';
  if (!create && !Number.isSafeInteger(input.version) || !create && Number(input.version) < 0) fields.version = 'Tải lại lịch trước khi lưu.';
  if (!create && !['edit', 'reschedule', 'complete', 'cancel', 'correct'].includes(String(action))) fields.action = 'Thao tác không hợp lệ.';
  if (input.reason !== undefined && !text(input.reason, 0, 1000)) fields.reason = 'Lý do tối đa 1.000 ký tự.';
  if (['reschedule', 'cancel', 'correct'].includes(String(action)) && !text(input.reason, 3, 1000)) fields.reason = 'Nhập lý do từ 3 đến 1.000 ký tự.';
  if (!object(input.data)) return { ...fields, form: 'Thông tin lịch hẹn không hợp lệ.' };
  const d = input.data, full = ['title', 'channel', 'location', 'property_id', 'notes'];
  const keys = action === 'create' ? [...full, 'lead_id', 'starts_at', 'ends_at', 'request_key', ...(role === 'Admin' ? ['sales_id'] : [])] : action === 'edit' ? full : action === 'reschedule' ? ['starts_at', 'ends_at'] : action === 'complete' ? ['result'] : action === 'cancel' ? [] : [...full, 'starts_at', 'ends_at', 'status', 'result', 'cancel_reason'];
  if (Object.keys(d).some(k => !keys.includes(k))) fields.form = 'Chỉ cập nhật các trường của thao tác đã chọn.';
  if (create && (!id(d.lead_id) || !id(d.request_key))) fields.lead_id = 'Chọn Lead và mã lần lưu hợp lệ.';
  if (['create', 'edit', 'correct'].includes(String(action))) {
    if (!text(d.title, 3, 200)) fields.title = 'Tiêu đề từ 3 đến 200 ký tự.';
    if (!appointmentChannels.includes(String(d.channel))) fields.channel = 'Chọn hình thức hẹn.';
    if (!text(d.location, d.channel === 'Phone' ? 0 : 3, 1000)) fields.location = 'Nhập địa điểm hoặc đường dẫn cuộc họp (tối đa 1.000 ký tự).';
    if (d.channel === 'Online' && (typeof d.location !== 'string' || !/^https?:\/\/[^\s]+$/i.test(d.location.trim()))) fields.location = 'Nhập đường dẫn http:// hoặc https:// hợp lệ.';
    if (!text(d.notes, 0, 3000)) fields.notes = 'Ghi chú tối đa 3.000 ký tự.';
    if (d.property_id !== null && !id(d.property_id)) fields.property_id = 'BĐS không hợp lệ.';
  }
  if (['create', 'reschedule', 'correct'].includes(String(action))) {
    if (!instant(d.starts_at) || !instant(d.ends_at) || Date.parse(String(d.ends_at)) <= Date.parse(String(d.starts_at))) fields.time = 'Chọn thời gian bắt đầu/kết thúc hợp lệ, giờ kết thúc phải sau giờ bắt đầu.';
    // Future-only and completion eligibility depend on role and the database clock.
    // They are deliberately enforced again by the mutation RPC.
  }
  if (action === 'complete' && !text(d.result, 3, 3000)) fields.result = 'Kết quả từ 3 đến 3.000 ký tự.';
  if (action === 'correct') {
    if (!appointmentStatuses.includes(String(d.status))) fields.status = 'Trạng thái không hợp lệ.';
    if (!text(d.result, d.status === 'COMPLETED' ? 3 : 0, 3000) || d.status !== 'COMPLETED' && d.result !== '') fields.result = 'Chỉ lịch hoàn thành được ghi kết quả.';
    if (!text(d.cancel_reason, d.status === 'CANCELLED' ? 3 : 0, 1000) || d.status !== 'CANCELLED' && d.cancel_reason !== '') fields.cancel_reason = 'Chỉ lịch đã hủy được ghi lý do hủy.';
  }
  return fields;
}
