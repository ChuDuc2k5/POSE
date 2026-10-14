import { authClient } from '../auth/session.js';
import { catalogDatabaseError, catalogError, catalogJson } from './catalog.service.js';

export async function GET() {
  try {
    const result=await authClient().from('property_projects').select('id,name').eq('archived',false).order('name').order('id').limit(500);
    if (result.error) return catalogDatabaseError(result.error);
    return catalogJson({items:result.data});
  } catch { return catalogError('CATALOG_UNAVAILABLE','Chưa thể tải danh sách dự án.',503); }
}
