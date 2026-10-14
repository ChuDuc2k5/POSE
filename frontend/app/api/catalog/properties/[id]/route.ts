import { NextRequest } from 'next/server';
import { authClient } from '@/lib/auth-server';
import { uuidPattern } from '@/lib/catalog';
import { catalogDatabaseError, catalogError, catalogJson } from '@/lib/catalog-server';

export async function GET(_request: NextRequest,context: RouteContext<'/api/catalog/properties/[id]'>) {
  try {
    const {id}=await context.params;
    if (!uuidPattern.test(id)) return catalogError('NOT_FOUND','Không tìm thấy sản phẩm.',404);
    // Always use Guest permissions, including when an Admin previews this page.
    const client=authClient();
    const property=await client.from('property_public_catalog').select('*').eq('id',id).maybeSingle();
    if (property.error) return catalogDatabaseError(property.error);
    if (!property.data) return catalogError('NOT_FOUND','Sản phẩm không tồn tại hoặc không còn được công bố.',404);
    const media=await client.from('property_media').select('id,name,media_type,sort_order').eq('property_id',id).eq('visibility','Public').eq('visible',true).eq('removed',false).order('sort_order').order('id');
    if (media.error) return catalogDatabaseError(media.error);
    const {revision: _revision,...item}=property.data; void _revision;
    return catalogJson({item,media:media.data});
  } catch { return catalogError('CATALOG_UNAVAILABLE','Chưa thể tải chi tiết sản phẩm.',503); }
}
