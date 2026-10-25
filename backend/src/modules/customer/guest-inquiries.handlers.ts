import { createHash, randomBytes } from 'node:crypto';
import { cookies, currentClientIp, validOrigin, type WebRequest } from '../../common/http.js';
import { authenticatedSession, consumeAttempt } from '../auth/session.js';
import { systemClient } from '../supabase/supabase.service.js';
import { inquiryInput } from '../../common/discovery.js';
import { inquiryEvents } from '../../common/inquiry-events.js';
import { catalogError, catalogInput, catalogJson } from '../catalog/catalog.service.js';
import { discoveryError } from './customer.service.js';

const cookie='pose-guest-inquiries';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
async function guestToken() { const value=(await cookies()).get(cookie)?.value; return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value:null; }
export async function POST(request:WebRequest) {
  if(!validOrigin(request))return catalogError('INVALID_ORIGIN','Yêu cầu không hợp lệ.',403);
  try {
    const session=await authenticatedSession();
    if(session)return catalogError('USE_CUSTOMER_FORM','Sử dụng biểu mẫu phù hợp với tài khoản hiện tại.',403);
    if(!consumeAttempt('guest-inquiry',currentClientIp(),20))return catalogError('RATE_LIMIT','Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.',429);
    const parsed=await catalogInput(request);if('error' in parsed)return parsed.error;
    const {data,key,fields}=inquiryInput(parsed.input,true);
    if(Object.keys(fields).length)return catalogError('INVALID_INPUT','Kiểm tra thông tin yêu cầu tư vấn.',400,fields);
    const token=await guestToken() || randomBytes(32).toString('base64url');
    const result=await systemClient().rpc('pose_submit_browser_inquiry',{p_data:data,p_key:key,p_session_hash:hash(token)});
    if(result.error?.message?.includes('BROWSER_SESSION_EXPIRED')){(await cookies()).delete(cookie);return catalogError('SESSION_EXPIRED','Phiên khách đã hết hạn. Vui lòng gửi lại yêu cầu để tạo phiên mới.',410);}
    if(result.error)return discoveryError(result.error);
    (await cookies()).set(cookie,token,{path:'/',httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:30*24*60*60});
    if(!result.data.replayed)inquiryEvents.emit('received');
    return catalogJson(result.data,result.data.replayed ? 200:201);
  }catch{return catalogError('UNAVAILABLE','Chưa thể gửi yêu cầu. Vui lòng thử lại với cùng nội dung.',503);}
}
export async function GET(request:WebRequest) {
  try {
    const token=await guestToken();
    if(!token)return catalogJson({items:[],total:0,page:1,pageSize:12});
    const page=Number(request.nextUrl.searchParams.get('page') || 1);
    if(!Number.isSafeInteger(page)||page<1||page>10000)return catalogError('INVALID_PAGE','Trang không hợp lệ.',400);
    const result=await systemClient().rpc('pose_read_browser_inquiries',{p_session_hash:hash(token),p_page:page,p_size:12});
    if(result.error)return discoveryError(result.error);
    return catalogJson(result.data);
  }catch{return catalogError('UNAVAILABLE','Chưa thể tải yêu cầu trên trình duyệt này.',503);}
}
