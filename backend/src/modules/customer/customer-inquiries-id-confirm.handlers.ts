import { WebRequest } from '../../common/http.js';
import { uuidPattern } from '../../common/catalog.js';
import { customerSession, discoveryError } from './customer.service.js';
import { catalogError, catalogJson } from '../catalog/catalog.service.js';

export async function POST(request: WebRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await customerSession(request);
    if ('error' in access) return access.error;
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return catalogError('NOT_FOUND', 'Không tìm thấy yêu cầu.', 404);
    if ((await request.text()).trim()) return catalogError('INVALID_INPUT', 'Yêu cầu không cần dữ liệu bổ sung.', 400);
    const result = await access.client.rpc('pose_confirm_inquiry', { p_id: id });
    if (result.error) return discoveryError(result.error);
    return catalogJson(result.data);
  } catch {
    return catalogError('UNAVAILABLE', 'Chưa thể kiểm tra xác minh yêu cầu.', 503);
  }
}
