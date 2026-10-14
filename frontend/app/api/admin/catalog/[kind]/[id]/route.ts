import { NextRequest } from 'next/server';
import { isCatalogKind, uuidPattern, validateCatalog } from '@/lib/catalog';
import { catalogAdmin, catalogDatabaseError, catalogError, catalogInput, catalogJson, catalogTables } from '@/lib/catalog-server';

export async function GET(request: NextRequest, context: RouteContext<'/api/admin/catalog/[kind]/[id]'>) {
  try {
    const access = await catalogAdmin(); if (access.error) return access.error;
    const { kind, id } = await context.params;
    if (!isCatalogKind(kind) || !uuidPattern.test(id)) return catalogError('NOT_FOUND','Không tìm thấy dữ liệu.',404);
    const record = await access.client.from(catalogTables[kind]).select('*').eq('id',id).maybeSingle();
    if (record.error) return catalogDatabaseError(record.error);
    if (!record.data) return catalogError('NOT_FOUND','Không tìm thấy dữ liệu.',404);
    const history = await access.client.from('property_history').select('*').eq('entity_kind',kind).eq('entity_id',id).order('created_at',{ascending:false}).limit(20);
    if (history.error) return catalogDatabaseError(history.error);
    const mediaPage=Number(request.nextUrl.searchParams.get('mediaPage') || 1);
    if (!Number.isSafeInteger(mediaPage) || mediaPage<1 || mediaPage>10000) return catalogError('INVALID_PAGE','Phân trang tệp không hợp lệ.',400);
    const media = kind === 'properties' ? await access.client.from('property_media').select('id,property_id,name,media_type,visibility,visible,removed,sort_order,size_bytes,version',{count:'exact'}).eq('property_id',id).eq('removed',false).order('sort_order').order('id').range((mediaPage-1)*50,mediaPage*50-1) : {data:[],error:null,count:0};
    if (media.error) return catalogDatabaseError(media.error);
    return catalogJson({ item: record.data, history: history.data, media: media.data, mediaTotal:media.count });
  } catch { return catalogError('CATALOG_UNAVAILABLE','Không thể tải chi tiết. Vui lòng thử lại.',503); }
}
export async function PATCH(request: NextRequest, context: RouteContext<'/api/admin/catalog/[kind]/[id]'>) {
  try {
    const access = await catalogAdmin(request); if (access.error) return access.error;
    const { kind,id } = await context.params;
    if (!isCatalogKind(kind) || !uuidPattern.test(id)) return catalogError('NOT_FOUND','Không tìm thấy dữ liệu.',404);
    const parsed = await catalogInput(request); if (parsed.error) return parsed.error;
    const errors = validateCatalog(kind,parsed.input);
    if (Object.keys(errors).length) return catalogError('VALIDATION_FAILED','Kiểm tra thông tin trước khi lưu.',400,errors);
    const {version,reason = '',...data} = parsed.input;
    const saved = await access.client.rpc('pose_save_catalog',{p_kind:kind,p_id:id,p_version:version,p_data:data,p_reason:reason});
    if (saved.error) return catalogDatabaseError(saved.error);
    return catalogJson({ item: saved.data, message: 'Đã lưu thay đổi.' });
  } catch { return catalogError('CATALOG_UNAVAILABLE','Không thể lưu dữ liệu. Vui lòng thử lại.',503); }
}
