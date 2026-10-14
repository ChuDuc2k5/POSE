import { NextRequest } from 'next/server';
import { isCatalogKind, uuidPattern, validateCatalog } from '@/lib/catalog';
import { catalogAdmin, catalogDatabaseError, catalogError, catalogInput, catalogJson, catalogTables } from '@/lib/catalog-server';

export async function GET(request: NextRequest, context: RouteContext<'/api/admin/catalog/[kind]'>) {
  try {
    const access = await catalogAdmin(); if (access.error) return access.error;
    const { kind } = await context.params;
    if (!isCatalogKind(kind) || kind === 'media') return catalogError('NOT_FOUND','Không tìm thấy danh mục.',404);
    const params = request.nextUrl.searchParams;
    const page = Number(params.get('page') || 1), pageSize = Number(params.get('pageSize') || 20);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) return catalogError('INVALID_PAGE','Phân trang không hợp lệ (tối đa 50 mục/trang).',400);
    const search = (params.get('search') || '').trim();
    if (search.length > 160) return catalogError('INVALID_SEARCH','Từ khóa tối đa 160 ký tự.',400);
    let query = access.client.from(catalogTables[kind]).select('*', { count: 'exact' });
    // Escape PostgREST filter punctuation and LIKE wildcards before interpolation.
    const term = search.replace(/[(),.\\"']/g,' ').trim().replace(/[%_]/g,'\\$&');
    if (term) query = query.or(`code.ilike.%${term}%,name.ilike.%${term}%`);
    const project = params.get('project');
    if (project && kind !== 'projects') { if (!uuidPattern.test(project)) return catalogError('INVALID_PARENT','Dự án không hợp lệ.',400); query = query.eq('project_id',project); }
    const status = params.get('status');
    if (status) {
      if (kind === 'properties') {
        if (!['Draft','Published','Hidden','Archived'].includes(status)) return catalogError('INVALID_STATUS','Trạng thái không hợp lệ.',400);
        query = query.eq('publication',status);
      } else if (['active','archived'].includes(status)) query = query.eq('archived',status === 'archived');
      else return catalogError('INVALID_STATUS','Trạng thái không hợp lệ.',400);
    }
    const { data, error, count } = await query.order('updated_at',{ascending:false}).order('id').range((page-1)*pageSize,page*pageSize-1);
    if (error) return catalogDatabaseError(error);
    return catalogJson({ items: data, total: count, page, pageSize });
  } catch { return catalogError('CATALOG_UNAVAILABLE','Không thể tải danh mục. Vui lòng thử lại.',503); }
}
export async function POST(request: NextRequest, context: RouteContext<'/api/admin/catalog/[kind]'>) {
  try {
    const access = await catalogAdmin(request); if (access.error) return access.error;
    const { kind } = await context.params;
    if (!isCatalogKind(kind) || kind === 'media') return catalogError('NOT_FOUND','Không tìm thấy danh mục.',404);
    const parsed = await catalogInput(request); if (parsed.error) return parsed.error;
    const errors = validateCatalog(kind,parsed.input);
    if (parsed.input.version !== 0) errors.version='Phiên bản tạo mới phải bằng 0.';
    if (Object.keys(errors).length) return catalogError('VALIDATION_FAILED','Kiểm tra thông tin trước khi lưu.',400,errors);
    const { version, reason = '', ...data } = parsed.input;
    const saved = await access.client.rpc('pose_save_catalog',{p_kind:kind,p_id:null,p_version:version,p_data:data,p_reason:reason});
    if (saved.error) return catalogDatabaseError(saved.error);
    return catalogJson({ item: saved.data, message: 'Đã tạo dữ liệu mới.' },201);
  } catch { return catalogError('CATALOG_UNAVAILABLE','Không thể tạo dữ liệu. Vui lòng thử lại.',503); }
}
