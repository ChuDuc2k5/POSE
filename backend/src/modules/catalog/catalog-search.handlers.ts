import { WebRequest } from '../../common/http.js';
import { authClient } from '../auth/session.js';
import { searchParameters } from '../../common/discovery.js';
import { catalogError, catalogJson } from './catalog.service.js';
import { discoveryError } from '../customer/customer.service.js';

export async function GET(request: WebRequest) {
  try {
    const { filters,page,pageSize,snapshot,fields }=searchParameters(request.nextUrl.searchParams);
    if (Object.keys(fields).length) return catalogError('INVALID_FILTER','Kiểm tra bộ lọc tìm kiếm.',400,fields);
    const result=await authClient().rpc('pose_search_properties',{p_filters:filters,p_page:page,p_size:pageSize,p_snapshot:snapshot});
    if (result.error) return discoveryError(result.error);
    return catalogJson(result.data);
  } catch { return catalogError('CATALOG_UNAVAILABLE','Chưa thể tìm kiếm bất động sản.',503); }
}
