import { validOrigin, WebRequest } from '../../common/http.js';
import { authenticatedSession, authClient } from '../auth/session.js';
import { uuidPattern } from '../../common/catalog.js';
import { catalogDatabaseError, catalogError, catalogJson } from './catalog.service.js';

export async function POST(request: WebRequest, context: { params: Promise<{ id: string }> }) {
  if (!validOrigin(request)) return catalogError('INVALID_ORIGIN', 'Yêu cầu không hợp lệ.', 403);
  try {
    const session = await authenticatedSession();
    if (!session) return catalogError('UNAUTHORIZED', 'Vui lòng đăng nhập.', 401);
    if (session.role !== 'User')
      return catalogError('CUSTOMER_REQUIRED', 'Chỉ tài khoản khách hàng mới ghi nhận lượt xem.', 403);
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return catalogError('NOT_FOUND', 'Không tìm thấy sản phẩm.', 404);
    const { data, error } = await authClient(session.access).rpc('pose_record_property_view', { p_property: id });
    if (error?.message?.includes('VIEW_RATE_LIMIT'))
      return catalogError('RATE_LIMITED', 'Bạn đã xem quá nhiều sản phẩm trong thời gian ngắn.', 429);
    if (error) return catalogDatabaseError(error);
    return catalogJson(data);
  } catch {
    return catalogError('CATALOG_UNAVAILABLE', 'Chưa thể ghi nhận lượt xem sản phẩm.', 503);
  }
}
