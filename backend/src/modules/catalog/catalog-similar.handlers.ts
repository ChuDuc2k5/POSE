import { WebRequest } from '../../common/http.js';
import { authClient } from '../auth/session.js';
import { uuidPattern } from '../../common/catalog.js';
import { catalogDatabaseError, catalogError, catalogJson } from './catalog.service.js';

export async function GET(_request: WebRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuidPattern.test(id)) return catalogError('NOT_FOUND', 'Không tìm thấy sản phẩm.', 404);
  try {
    const result = await authClient().rpc('pose_similar_properties', { p_property: id, p_limit: 4 });
    if (result.error) return catalogDatabaseError(result.error);
    return catalogJson({ items: result.data || [] });
  } catch { return catalogError('CATALOG_UNAVAILABLE', 'Chưa thể tải sản phẩm tương tự.', 503); }
}
