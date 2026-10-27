import type { SupabaseClient } from '@supabase/supabase-js';
import type { WebRequest } from '../../common/http.js';
import { validOrigin } from '../../common/http.js';
import { uuidPattern } from '../../common/catalog.js';
import { authenticatedSession, authClient } from '../auth/session.js';
import { catalogError, catalogInput, catalogJson } from '../catalog/catalog.service.js';
import { leadListQuery, validateLeadMutation } from './leads.validation.js';
export function leadDatabaseError(error: { code?: string; message?: string }) {
  const message = error.message || '';
  if (error.code === '42501') return catalogError('FORBIDDEN', 'Bạn không có quyền thao tác trên Lead này.', 403);
  if (error.code === 'P0002') return catalogError('NOT_FOUND', 'Không tìm thấy hồ sơ hoặc sản phẩm.', 404);
  if (error.code === '40001')
    return catalogError(
      'VERSION_CONFLICT',
      'Dữ liệu hoặc kết quả phân công đã thay đổi. Tải lại hồ sơ trước khi tiếp tục.',
      409,
    );
  if (error.code === '23505')
    return catalogError(
      'OPEN_LEAD_CONFLICT',
      'Khách đã có Lead đang mở hoặc phân công đã thay đổi. Vui lòng tải lại.',
      409,
    );
  if (['PGRST202', '42P01', '42883'].includes(error.code || ''))
    return catalogError('LEAD_NOT_READY', 'Chức năng quản lý Lead chưa sẵn sàng. Liên hệ quản trị viên.', 503);
  const descriptions: Record<string, string> = {
    LEAD_REASON_REQUIRED: 'Nhập lý do thay đổi từ 3 đến 1.000 ký tự.',
    LEAD_ARCHIVE_CLOSED_ONLY: 'Chỉ lưu trữ hoặc bỏ lưu trữ Lead đã kết thúc.',
    LEAD_ARCHIVED: 'Bỏ lưu trữ hồ sơ trước khi cập nhật.',
    LEAD_PURCHASE_REQUIRED: 'Chọn BĐS đã mua và ngày mua hợp lệ.',
    LEAD_SALES_INACTIVE: 'Nhân viên được chọn không còn đủ điều kiện nhận Lead.',
    LEAD_INVALID_BUDGET: 'Khoảng ngân sách không hợp lệ.',
    LEAD_ALREADY_ASSIGNED: 'Lead đã có Sales phụ trách. Chức năng này không hỗ trợ chuyển Sales.',
  };
  if (['22023', '22P02', '23514', '23502', '22003', '22007', '22008'].includes(error.code || '')) {
    return catalogError(
      'INVALID_INPUT',
      Object.entries(descriptions).find(([key]) => message.includes(key))?.[1] ||
        'Thông tin không hợp lệ. Kiểm tra các trường và lý do thay đổi.',
      400,
    );
  }
  return catalogError('UNAVAILABLE', 'Chưa thể xử lý Lead. Vui lòng thử lại.', 503);
}
async function session(request: WebRequest, admin = false) {
  if (request.method !== 'GET' && !validOrigin(request))
    return { error: catalogError('INVALID_ORIGIN', 'Yêu cầu không hợp lệ.', 403) } as const;
  const s = await authenticatedSession();
  if (!s) return { error: catalogError('UNAUTHORIZED', 'Vui lòng đăng nhập.', 401) } as const;
  if (!['Admin', 'Sales'].includes(s.role) || (admin && s.role !== 'Admin'))
    return { error: catalogError('FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.', 403) } as const;
  return { client: authClient(s.access), role: s.role } as const;
}
async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await client.rpc(name, args);
  return error ? leadDatabaseError(error) : catalogJson(data);
}
type Context = { params: Promise<{ id: string }> };

export async function list(request: WebRequest) {
  try {
    const access = await session(request);
    if ('error' in access) return access.error;
    const { filters, page, pageSize, fields } = leadListQuery(request.nextUrl.searchParams);
    if (Object.keys(fields).length) return catalogError('INVALID_INPUT', 'Kiểm tra bộ lọc Lead.', 400, fields);
    return rpc(access.client, 'pose_lead_list', { p_filters: filters, p_page: page, p_size: pageSize });
  } catch {
    return catalogError('UNAVAILABLE', 'Chưa thể tải danh sách Lead.', 503);
  }
}
export async function options(request: WebRequest) {
  try {
    const access = await session(request);
    if ('error' in access) return access.error;
    return rpc(access.client, 'pose_lead_options');
  } catch {
    return catalogError('UNAVAILABLE', 'Chưa thể tải danh sách nhân viên.', 503);
  }
}
export async function detail(request: WebRequest, context: Context) {
  try {
    const access = await session(request);
    if ('error' in access) return access.error;
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return catalogError('NOT_FOUND', 'Không tìm thấy Lead.', 404);
    return rpc(access.client, 'pose_lead_detail', { p_lead: id });
  } catch {
    return catalogError('UNAVAILABLE', 'Chưa thể tải hồ sơ Lead.', 503);
  }
}
export async function mutate(request: WebRequest, context: Context) {
  try {
    const access = await session(request);
    if ('error' in access) return access.error;
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return catalogError('NOT_FOUND', 'Không tìm thấy Lead.', 404);
    const parsed = await catalogInput(request);
    if ('error' in parsed) return parsed.error;
    const fields = validateLeadMutation(parsed.input);
    if (Object.keys(fields).length)
      return catalogError('INVALID_INPUT', 'Kiểm tra thông tin cập nhật Lead.', 400, fields);
    return rpc(access.client, 'pose_lead_mutate', {
      p_lead: id,
      p_version: parsed.input.version,
      p_action: parsed.input.action,
      p_data: parsed.input.data,
      p_reason: parsed.input.reason || '',
    });
  } catch {
    return catalogError('UNAVAILABLE', 'Chưa thể cập nhật Lead.', 503);
  }
}
export async function owners(request: WebRequest) {
  try {
    const access = await session(request, true);
    if ('error' in access) return access.error;
    const params = request.nextUrl.searchParams;
    if ([...params].some(([k]) => !['q', 'page', 'pageSize'].includes(k) || params.getAll(k).length > 1))
      return catalogError('INVALID_INPUT', 'Bộ lọc không hợp lệ.', 400);
    const { page, pageSize, fields } = leadListQuery(params);
    if (Object.keys(fields).length) return catalogError('INVALID_INPUT', 'Bộ lọc không hợp lệ.', 400, fields);
    return rpc(access.client, 'pose_lead_owners', { p_search: params.get('q') || '', p_page: page, p_size: pageSize });
  } catch {
    return catalogError('UNAVAILABLE', 'Chưa thể tải phân công bất động sản.', 503);
  }
}
export async function setOwner(request: WebRequest, context: Context) {
  try {
    const access = await session(request, true);
    if ('error' in access) return access.error;
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return catalogError('NOT_FOUND', 'Không tìm thấy BĐS.', 404);
    const parsed = await catalogInput(request);
    if ('error' in parsed) return parsed.error;
    const input = parsed.input;
    if (
      Object.keys(input).some((k) => !['sales_id', 'version', 'reason'].includes(k)) ||
      (input.sales_id !== null && (typeof input.sales_id !== 'string' || !uuidPattern.test(input.sales_id))) ||
      !Number.isSafeInteger(input.version) ||
      Number(input.version) < 0 ||
      typeof input.reason !== 'string' ||
      input.reason.trim().length < 3 ||
      input.reason.length > 1000
    )
      return catalogError('INVALID_INPUT', 'Chọn Sales và nhập lý do thay đổi hợp lệ.', 400);
    return rpc(access.client, 'pose_lead_set_owner', {
      p_property: id,
      p_sales: input.sales_id,
      p_version: input.version,
      p_reason: input.reason,
    });
  } catch {
    return catalogError('UNAVAILABLE', 'Chưa thể lưu người phụ trách BĐS.', 503);
  }
}
export async function recheck(request: WebRequest) {
  try {
    const access = await session(request, true);
    if ('error' in access) return access.error;
    const parsed = await catalogInput(request);
    if ('error' in parsed) return parsed.error;
    const input = parsed.input;
    if (
      Object.keys(input).some((k) => k !== 'lead_id') ||
      (input.lead_id != null && (typeof input.lead_id !== 'string' || !uuidPattern.test(input.lead_id)))
    )
      return catalogError('INVALID_INPUT', 'Lead không hợp lệ.', 400);
    return rpc(access.client, 'pose_lead_recheck', { p_lead: input.lead_id || null });
  } catch {
    return catalogError('UNAVAILABLE', 'Chưa thể xét phân công.', 503);
  }
}
