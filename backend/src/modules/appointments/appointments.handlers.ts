import { uuidPattern } from '../../common/catalog.js';
import { validOrigin, type WebRequest } from '../../common/http.js';
import { authenticatedSession, authClient } from '../auth/session.js';
import { catalogError, catalogInput, catalogJson } from '../catalog/catalog.service.js';
import { formerDistrictFromLocation } from '../ai/ward-label.js';
import { scoreSalesSuggestions, type SalesSuggestionFact } from './sales-suggestions.js';
import { appointmentQuery, validateAppointment } from './appointments.validation.js';
type Context = { params: Promise<{ id: string }> };
export function appointmentError(error: { code?: string; message?: string }) {
  const message = error.message || '';
  if (error.code === '23P01')
    return catalogError('APPOINTMENT_OVERLAP', 'Sales đã có lịch hẹn trong khoảng thời gian này. Chọn giờ khác.', 409);
  if (message.includes('LEAD_LOCKED'))
    return catalogError('LEAD_LOCKED', 'Lead đã kết thúc hoặc lưu trữ. Chỉ Admin được xử lý lịch còn lại.', 409);
  if (message.includes('NOT_STARTED')) return catalogError('NOT_STARTED', 'Chưa đến giờ bắt đầu cuộc hẹn.', 409);
  if (message.includes('APPOINTMENT_INCOMPLETE'))
    return catalogError(
      'APPOINTMENT_INCOMPLETE',
      'Lịch cũ còn thiếu thông tin. Admin cần bổ sung qua Sửa sai trước khi tiếp tục.',
      409,
    );
  if (message.includes('APPOINTMENT_LOCKED'))
    return catalogError('APPOINTMENT_LOCKED', 'Lịch đã hoàn thành hoặc hủy. Chỉ Admin được sửa sai có lý do.', 409);
  if (message.includes('IDEMPOTENCY_CONFLICT'))
    return catalogError('REQUEST_CONFLICT', 'Mã lần tạo đã được dùng với nội dung khác. Tải lại form.', 409);
  if (error.code === '40001' || error.code === '40P01')
    return catalogError('VERSION_CONFLICT', 'Dữ liệu vừa thay đổi. Tải lại lịch trước khi lưu.', 409);
  if (error.code === '42501')
    return catalogError(
      'FORBIDDEN',
      'Không có quyền xử lý lịch hoặc chọn BĐS này. BĐS phải thuộc Sales phụ trách.',
      403,
    );
  if (error.code === 'P0002') return catalogError('NOT_FOUND', 'Không tìm thấy lịch hẹn trong phạm vi của bạn.', 404);
  if (message.includes('FUTURE_REQUIRED'))
    return catalogError('INVALID_INPUT', 'Giờ bắt đầu phải ở tương lai.', 400, {
      starts_at: 'Chọn giờ hẹn ở tương lai.',
    });
  if (message.includes('NO_SALES'))
    return catalogError(
      'NO_SALES',
      'Lead chưa có Sales phụ trách đang hoạt động. Phân công Lead trước khi đặt lịch.',
      409,
    );
  if (message.includes('REASON_REQUIRED'))
    return catalogError('INVALID_INPUT', 'Nhập lý do thay đổi từ 3 đến 1.000 ký tự.', 400, {
      reason: 'Admin cần ghi lý do khi sửa sai; đổi/hủy lịch cũng cần lý do.',
    });
  if (['PGRST202', '42P01', '42883'].includes(error.code || ''))
    return catalogError('APPOINTMENTS_NOT_READY', 'Chức năng lịch hẹn chưa sẵn sàng. Liên hệ quản trị viên.', 503);
  if (['22023', '22P02', '22007', '22008', '22003', '23514', '23502', '23503'].includes(error.code || ''))
    return catalogError('INVALID_INPUT', 'Kiểm tra thông tin, thời gian và kết quả lịch hẹn.', 400);
  return catalogError('UNAVAILABLE', 'Chưa thể xử lý lịch hẹn. Vui lòng thử lại.', 503);
}
async function access(request: WebRequest, write = false) {
  if (write && !validOrigin(request))
    return { error: catalogError('INVALID_ORIGIN', 'Yêu cầu không hợp lệ.', 403) } as const;
  const session = await authenticatedSession();
  if (!session) return { error: catalogError('UNAUTHORIZED', 'Vui lòng đăng nhập.', 401) } as const;
  if (!['Admin', 'Sales'].includes(session.role))
    return { error: catalogError('FORBIDDEN', 'Bạn không có quyền quản lý lịch hẹn.', 403) } as const;
  return { role: session.role, client: authClient(session.access) } as const;
}
async function call(a: Awaited<ReturnType<typeof access>>, name: string, args: Record<string, unknown>, write = false) {
  if ('error' in a) return a.error;
  const builder = a.client.rpc(name, args);
  const result = await (write ? builder : builder.abortSignal(AbortSignal.timeout(12000)));
  return result.error ? appointmentError(result.error) : catalogJson(result.data);
}
export async function list(request: WebRequest) {
  try {
    const a = await access(request);
    if ('error' in a) return a.error;
    const q = appointmentQuery(request.nextUrl.searchParams);
    if (Object.keys(q.fields).length) return catalogError('INVALID_INPUT', 'Kiểm tra bộ lọc lịch hẹn.', 400, q.fields);
    if (a.role !== 'Admin' && q.filters.sales_id)
      return catalogError('FORBIDDEN', 'Sales chỉ xem lịch thuộc phạm vi mình phụ trách.', 403);
    return await call(a, 'pose_appointment_list', { p_filters: q.filters, p_page: q.page, p_size: q.pageSize });
  } catch {
    return catalogError('UNAVAILABLE', 'Chưa thể tải lịch hẹn.', 503);
  }
}
export async function options(request: WebRequest) {
  try {
    const a = await access(request);
    if ('error' in a) return a.error;
    const q = appointmentQuery(request.nextUrl.searchParams, true);
    if (Object.keys(q.fields).length)
      return catalogError('INVALID_INPUT', 'Kiểm tra thông tin tìm kiếm.', 400, q.fields);
    if (a.role !== 'Admin' && q.filters.kind === 'sales')
      return catalogError('FORBIDDEN', 'Sales chỉ xem lịch của mình.', 403);
    return await call(a, 'pose_appointment_options', {
      p_kind: q.filters.kind,
      p_query: q.filters.q || '',
      p_lead: q.filters.lead_id || null,
      p_page: q.page,
    });
  } catch {
    return catalogError('UNAVAILABLE', 'Chưa thể tải danh mục lịch hẹn.', 503);
  }
}
export async function salesSuggestions(request: WebRequest) {
  try {
    const a = await access(request);
    if ('error' in a) return a.error;
    if (a.role !== 'Admin') return catalogError('FORBIDDEN', 'Only Admin can view Sales suggestions.', 403);
    const params = request.nextUrl.searchParams,
      leadId = params.get('lead_id'),
      propertyId = params.get('property_id');
    if (
      !leadId ||
      !uuidPattern.test(leadId) ||
      (propertyId && !uuidPattern.test(propertyId)) ||
      [...params.keys()].some((key) => !['lead_id', 'property_id'].includes(key))
    ) {
      return catalogError('INVALID_INPUT', 'Lead and property identifiers are invalid.', 400);
    }
    const result = await a.client.rpc('pose_admin_sales_suggestion_facts', {
      p_lead: leadId,
      p_property: propertyId || null,
    });
    if (result.error) return appointmentError(result.error);
    const facts = result.data as {
      property_location?: string | null;
      history_location?: string | null;
      preference_location?: string | null;
      property_keeper_id?: string | null;
      candidates?: SalesSuggestionFact[];
    };
    const sources = [
      [facts.property_location, 'property'],
      [facts.history_location, 'history'],
      [facts.preference_location, 'preference'],
    ] as const;
    const found = sources.find(([location]) => formerDistrictFromLocation(location));
    const area = found ? formerDistrictFromLocation(found[0]) : null;
    const scored = scoreSalesSuggestions(facts.candidates || [], area, facts.property_keeper_id || null);
    return catalogJson({ area, area_source: found ? found[1] : null, suggestions: scored });
  } catch {
    return catalogError('UNAVAILABLE', 'Sales suggestions are unavailable.', 503);
  }
}
export async function detail(request: WebRequest, context: Context) {
  try {
    const a = await access(request);
    if ('error' in a) return a.error;
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return catalogError('NOT_FOUND', 'Không tìm thấy lịch hẹn.', 404);
    return await call(a, 'pose_appointment_detail', { p_id: id });
  } catch {
    return catalogError('UNAVAILABLE', 'Chưa thể tải lịch hẹn.', 503);
  }
}
export async function save(request: WebRequest, context: Context, create = false) {
  try {
    const a = await access(request, true);
    if ('error' in a) return a.error;
    const id = create ? null : (await context.params).id;
    if (!create && !uuidPattern.test(id!)) return catalogError('NOT_FOUND', 'Không tìm thấy lịch hẹn.', 404);
    const parsed = await catalogInput(request);
    if ('error' in parsed) return parsed.error;
    const input = parsed.input;
    if (
      create &&
      a.role === 'Sales' &&
      input.data &&
      typeof input.data === 'object' &&
      !Array.isArray(input.data) &&
      'sales_id' in input.data
    )
      return catalogError('FORBIDDEN', 'Sales cannot choose another Sales user.', 403);
    const fields = validateAppointment(input, create, a.role === 'Admin' ? 'Admin' : 'Sales');
    if (Object.keys(fields).length) return catalogError('INVALID_INPUT', 'Kiểm tra thông tin lịch hẹn.', 400, fields);
    if (a.role !== 'Admin' && input.action === 'correct')
      return catalogError('FORBIDDEN', 'Chỉ Admin được sửa sai lịch đã kết thúc.', 403);
    if (a.role === 'Admin' && !create && (typeof input.reason !== 'string' || input.reason.trim().length < 3))
      return catalogError('INVALID_INPUT', 'Admin cần ghi lý do chỉnh sửa.', 400, {
        reason: 'Nhập lý do từ 3 đến 1.000 ký tự.',
      });
    return await call(
      a,
      'pose_appointment_mutate',
      {
        p_id: id,
        p_version: create ? null : input.version,
        p_action: create ? 'create' : input.action,
        p_data: input.data,
        p_reason: input.reason || '',
      },
      true,
    );
  } catch {
    return catalogError('UNAVAILABLE', 'Chưa thể lưu lịch hẹn.', 503);
  }
}
export const create = (request: WebRequest, context: Context) => save(request, context, true);
