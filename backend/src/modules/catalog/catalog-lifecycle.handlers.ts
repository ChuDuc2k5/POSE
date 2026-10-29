import { WebRequest } from '../../common/http.js';
import { uuidPattern, validateCatalogLifecycle } from '../../common/catalog.js';
import { catalogAdmin, catalogDatabaseError, catalogError, catalogInput, catalogJson } from './catalog.service.js';

async function change(request: WebRequest, context: { params: Promise<{ id: string }> }, action: 'delete' | 'restore') {
  try {
    const access = await catalogAdmin(request);
    if (access.error) return access.error;
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return catalogError('NOT_FOUND', 'Không tìm thấy sản phẩm.', 404);
    const parsed = await catalogInput(request);
    if (parsed.error) return parsed.error;
    const fields = validateCatalogLifecycle(parsed.input);
    if (Object.keys(fields).length)
      return catalogError('VALIDATION_FAILED', 'Kiểm tra lý do và phiên bản sản phẩm.', 400, fields);
    const saved = await access.client.rpc('pose_catalog_lifecycle', {
      p_id: id,
      p_version: parsed.input.version,
      p_action: action,
      p_reason: parsed.input.reason,
    });
    if (saved.error) return catalogDatabaseError(saved.error);
    return catalogJson({
      item: saved.data,
      message:
        action === 'delete'
          ? 'Đã chuyển sản phẩm vào thùng rác.'
          : 'Đã khôi phục sản phẩm về bản nháp. Kiểm tra thông tin trước khi công bố lại.',
    });
  } catch {
    return catalogError('CATALOG_UNAVAILABLE', 'Chưa thể thay đổi sản phẩm. Vui lòng thử lại.', 503);
  }
}
export function DELETE(request: WebRequest, context: { params: Promise<{ id: string }> }) {
  return change(request, context, 'delete');
}
export function RESTORE(request: WebRequest, context: { params: Promise<{ id: string }> }) {
  return change(request, context, 'restore');
}
