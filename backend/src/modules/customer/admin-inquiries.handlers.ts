import type { WebRequest } from '../../common/http.js';
import { uuidPattern } from '../../common/catalog.js';
import { catalogAdmin, catalogError, catalogJson } from '../catalog/catalog.service.js';
import { discoveryError } from './customer.service.js';
export async function GET(request:WebRequest) {
  try {
    const access=await catalogAdmin();if(access.error)return access.error;
    const page=Number(request.nextUrl.searchParams.get('page')||1),filter=request.nextUrl.searchParams.get('filter')||'all';
    if(!Number.isSafeInteger(page)||page<1||page>10000||!['all','unread'].includes(filter))return catalogError('INVALID_PAGE','Bộ lọc không hợp lệ.',400);
    const result=await access.client.rpc('pose_admin_inquiries',{p_page:page,p_unread:filter==='unread'});
    if(result.error)return discoveryError(result.error);
    return catalogJson(result.data);
  }catch{return catalogError('UNAVAILABLE','Chưa thể tải hộp thư tư vấn.',503);}
}
export async function READ(request:WebRequest,context:{params:Promise<{id:string}>}) {
  try {
    const access=await catalogAdmin(request);if(access.error)return access.error;
    const {id}=await context.params;
    if(!uuidPattern.test(id)||(await request.text()).trim())return catalogError('INVALID_INPUT','Yêu cầu không hợp lệ.',400);
    const result=await access.client.rpc('pose_read_admin_inquiry',{p_id:id});
    if(result.error)return discoveryError(result.error);
    return catalogJson(result.data);
  }catch{return catalogError('UNAVAILABLE','Chưa thể ghi nhận đã xem.',503);}
}
