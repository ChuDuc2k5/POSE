import { uuidPattern } from '../../common/catalog.js';
import { validateLeadMutation, leadStatuses } from '../leads/leads.validation.js';

export const channels = ['Phone', 'Message', 'InPerson', 'Online'];
const id = (v: unknown) => typeof v === 'string' && uuidPattern.test(v);
export function salesQuery(params: URLSearchParams, kind: 'leads' | 'properties' | 'activities') {
  const keys = {
    leads: ['status', 'temperature', 'archived'],
    properties: ['property_type', 'location', 'publication', 'availability'],
    activities: ['channel', 'lead_id', 'cancelled'],
  };
  const allowed = ['q', 'sales_id', 'page', 'pageSize', ...keys[kind]];
  const fields: Record<string, string> = {},
    filters: Record<string, string> = {};
  for (const [k, v] of params) {
    if (!allowed.includes(k) || params.getAll(k).length > 1) fields.form = 'Bộ lọc không hợp lệ.';
    else if (v.trim() && !['page', 'pageSize'].includes(k)) filters[k] = v.trim();
  }
  const page = Number(params.get('page') || 1),
    pageSize = Number(params.get('pageSize') || 12);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 10000 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 50
  )
    fields.page = 'Trang không hợp lệ.';
  if ((filters.q || '').length > 120 || (filters.location || '').length > 200) fields.q = 'Từ khóa quá dài.';
  for (const k of ['sales_id', 'lead_id']) if (filters[k] && !id(filters[k])) fields[k] = 'Mã không hợp lệ.';
  const enums: Record<string, readonly string[]> = {
    status: leadStatuses,
    temperature: ['HOT', 'WARM', 'COLD', 'UNRATED'],
    archived: ['true', 'false'],
    cancelled: ['true', 'false'],
    channel: channels,
    property_type: ['Apartment', 'House', 'Land', 'Villa', 'Office', 'Shop'],
    publication: ['Draft', 'Published', 'Hidden', 'Archived'],
    availability: ['Available', 'Reserved', 'Sold', 'Unavailable'],
  };
  for (const [k, values] of Object.entries(enums))
    if (filters[k] && !values.includes(filters[k])) fields[k] = 'Lựa chọn không hợp lệ.';
  return { filters, page, pageSize, fields };
}
export function validateSalesMutation(input: Record<string, unknown>) {
  if (input.action === 'confirm_needs' || input.action === 'result') {
    return validateLeadMutation({ ...input, action: input.action === 'confirm_needs' ? 'profile' : 'status' });
  }
  const fields: Record<string, string> = {};
  if (Object.keys(input).some((k) => !['action', 'version', 'data', 'reason'].includes(k)))
    fields.form = 'Dữ liệu chứa trường không được phép.';
  if (!Number.isSafeInteger(input.version) || Number(input.version) < 0)
    fields.version = 'Tải lại hồ sơ trước khi lưu.';
  if (!['activity_create', 'activity_edit', 'activity_cancel'].includes(String(input.action)))
    fields.action = 'Thao tác không hợp lệ.';
  if (
    input.action !== 'activity_create' &&
    (typeof input.reason !== 'string' || input.reason.trim().length < 3 || input.reason.length > 1000)
  )
    fields.reason = 'Nhập lý do từ 3 đến 1.000 ký tự.';
  if (input.reason !== undefined && (typeof input.reason !== 'string' || input.reason.length > 1000))
    fields.reason = 'Lý do không hợp lệ.';
  if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data))
    return { ...fields, form: 'Thông tin không hợp lệ.' };
  const d = input.data as Record<string, unknown>;
  const keys =
    input.action === 'activity_cancel'
      ? ['activity_id', 'activity_version']
      : [
          'occurred_at',
          'channel',
          'content',
          'feedback',
          'property_ids',
          ...(input.action === 'activity_create' ? ['request_key'] : ['activity_id', 'activity_version']),
        ];
  if (Object.keys(d).some((k) => !keys.includes(k))) fields.form = 'Chỉ cập nhật các trường của thao tác đã chọn.';
  if (input.action === 'activity_create') {
    if (!id(d.request_key)) fields.request_key = 'Mã lần lưu không hợp lệ.';
  } else if (!id(d.activity_id) || !Number.isSafeInteger(d.activity_version) || Number(d.activity_version) < 0)
    fields.activity_id = 'Tải lại hoạt động trước khi lưu.';
  if (input.action !== 'activity_cancel') {
    if (
      typeof d.occurred_at !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(d.occurred_at) ||
      !Number.isFinite(Date.parse(d.occurred_at)) ||
      Date.parse(d.occurred_at) > Date.now() + 60000
    )
      fields.occurred_at = 'Thời gian tư vấn không hợp lệ hoặc ở tương lai.';
    if (!channels.includes(String(d.channel))) fields.channel = 'Chọn kênh tư vấn.';
    if (typeof d.content !== 'string' || d.content.trim().length < 3 || d.content.length > 5000)
      fields.content = 'Nội dung từ 3 đến 5.000 ký tự.';
    if (typeof d.feedback !== 'string' || d.feedback.length > 3000) fields.feedback = 'Phản hồi tối đa 3.000 ký tự.';
    if (
      !Array.isArray(d.property_ids) ||
      d.property_ids.length > 20 ||
      d.property_ids.some((v) => !id(v)) ||
      new Set(d.property_ids).size !== d.property_ids.length
    )
      fields.property_ids = 'Chọn tối đa 20 BĐS khác nhau.';
  }
  return fields;
}
