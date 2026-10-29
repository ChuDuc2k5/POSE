import type { WebRequest } from '../../common/http.js';
import { authenticatedSession, authClient } from '../auth/session.js';
import { catalogError, catalogJson } from '../catalog/catalog.service.js';
import { reportQuery } from './reports.validation.js';

function databaseError(error: { code?: string }) {
  if (error.code === '42501') return catalogError('FORBIDDEN', 'Bạn không có quyền xem báo cáo này.', 403);
  if (['22023', '22P02', '22007', '22008'].includes(error.code || ''))
    return catalogError('INVALID_INPUT', 'Kiểm tra khoảng ngày và bộ lọc báo cáo.', 400);
  if (['PGRST202', '42P01', '42883'].includes(error.code || ''))
    return catalogError('REPORT_NOT_READY', 'Báo cáo Lead chưa sẵn sàng. Liên hệ quản trị viên.', 503);
  return catalogError('REPORT_UNAVAILABLE', 'Chưa thể tải báo cáo. Vui lòng thử lại.', 503);
}
async function staff() {
  const session = await authenticatedSession();
  if (!session) return { error: catalogError('UNAUTHORIZED', 'Vui lòng đăng nhập.', 401) } as const;
  if (session.role !== 'Admin' && session.role !== 'Sales')
    return { error: catalogError('FORBIDDEN', 'Bạn không có quyền xem báo cáo.', 403) } as const;
  return { role: session.role, client: authClient(session.access) } as const;
}
export async function leads(request: WebRequest) {
  try {
    const access = await staff();
    if ('error' in access) return access.error;
    const { filters, fields } = reportQuery(request.nextUrl.searchParams);
    if (Object.keys(fields).length) return catalogError('INVALID_INPUT', 'Kiểm tra bộ lọc báo cáo.', 400, fields);
    if (filters.sales_id && access.role !== 'Admin')
      return catalogError('FORBIDDEN', 'Sales chỉ xem báo cáo thuộc phạm vi mình phụ trách.', 403);
    const result = await access.client
      .rpc('pose_report_leads', { p_filters: filters })
      .abortSignal(AbortSignal.timeout(12000));
    return result.error ? databaseError(result.error) : catalogJson(result.data);
  } catch {
    return catalogError('REPORT_UNAVAILABLE', 'Chưa thể tải báo cáo. Vui lòng thử lại.', 503);
  }
}
export async function options(request: WebRequest) {
  try {
    const access = await staff();
    if ('error' in access) return access.error;
    if (request.nextUrl.searchParams.size) return catalogError('INVALID_INPUT', 'Yêu cầu không hợp lệ.', 400);
    const result = await access.client.rpc('pose_report_options').abortSignal(AbortSignal.timeout(12000));
    return result.error ? databaseError(result.error) : catalogJson(result.data);
  } catch {
    return catalogError('REPORT_UNAVAILABLE', 'Chưa thể tải bộ lọc Sales.', 503);
  }
}
