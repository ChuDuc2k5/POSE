import { NextRequest } from 'next/server';
import { authClient } from '@/lib/auth-server';
import { searchParameters } from '@/lib/discovery';
import { catalogError, catalogJson } from '@/lib/catalog-server';
import { discoveryError } from '@/lib/discovery-server';

export async function GET(request: NextRequest) {
  try {
    const { filters,page,pageSize,snapshot,fields }=searchParameters(request.nextUrl.searchParams);
    if (Object.keys(fields).length) return catalogError('INVALID_FILTER','Kiểm tra bộ lọc tìm kiếm.',400,fields);
    const result=await authClient().rpc('pose_search_properties',{p_filters:filters,p_page:page,p_size:pageSize,p_snapshot:snapshot});
    if (result.error) return discoveryError(result.error);
    return catalogJson(result.data);
  } catch { return catalogError('CATALOG_UNAVAILABLE','Chưa thể tìm kiếm bất động sản.',503); }
}
