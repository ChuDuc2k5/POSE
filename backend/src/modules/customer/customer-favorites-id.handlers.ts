import { WebRequest } from '../../common/http.js';
import { uuidPattern } from '../../common/catalog.js';
import { customerSession, discoveryError } from './customer.service.js';
import { catalogError, catalogJson } from '../catalog/catalog.service.js';

async function change(request: WebRequest, context: { params: Promise<{ id: string }> }, saved: boolean) {
  try {
    const access = await customerSession(request);
    if ('error' in access) return access.error;
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return catalogError('NOT_FOUND', 'Không tìm thấy sản phẩm.', 404);
    if ((await request.text()).trim()) return catalogError('INVALID_INPUT', 'Yêu cầu không cần dữ liệu bổ sung.', 400);
    const result = await access.client.rpc('pose_set_favorite', { p_property: id, p_saved: saved });
    if (result.error) return discoveryError(result.error);
    return catalogJson(result.data);
  } catch {
    return catalogError('UNAVAILABLE', 'Chưa thể cập nhật yêu thích.', 503);
  }
}
export async function PUT(request: WebRequest, context: { params: Promise<{ id: string }> }) {
  return change(request, context, true);
}
export async function DELETE(request: WebRequest, context: { params: Promise<{ id: string }> }) {
  return change(request, context, false);
}
