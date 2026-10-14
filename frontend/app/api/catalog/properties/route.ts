import { NextRequest } from 'next/server';
import { authClient } from '@/lib/auth-server';
import { catalogDatabaseError, catalogError, catalogJson } from '@/lib/catalog-server';

// One live, public source for M03/M06. Always query as Guest so an Admin
// session cannot accidentally expand the public catalogue to drafts/internal data.
export async function GET(request: NextRequest) {
  try {
    const page=Number(request.nextUrl.searchParams.get('page') || 1), pageSize=Number(request.nextUrl.searchParams.get('pageSize') || 20);
    if (!Number.isSafeInteger(page) || page<1 || page>10000 || !Number.isSafeInteger(pageSize) || pageSize<1 || pageSize>50) return catalogError('INVALID_PAGE','Phân trang không hợp lệ.',400);
    let query=authClient().from('property_products').select('id,code,name,project_id,subdivision_id,property_type,area,bedrooms,price,currency,location,description,publication,availability,version,updated_at',{count:'exact'}).eq('publication','Published');
    if (request.nextUrl.searchParams.get('available')==='true') query=query.eq('availability','Available');
    const result=await query.order('updated_at',{ascending:false}).order('id').range((page-1)*pageSize,page*pageSize-1);
    if(result.error)return catalogDatabaseError(result.error);
    return catalogJson({items:result.data,total:result.count,page,pageSize});
  } catch { return catalogError('CATALOG_UNAVAILABLE','Không thể tải sản phẩm. Vui lòng thử lại.',503); }
}
