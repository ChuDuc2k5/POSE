import { NextRequest } from 'next/server';
import { customerSession, discoveryError } from '@/lib/discovery-server';
import { inquiryInput } from '@/lib/discovery';
import { catalogError, catalogInput, catalogJson } from '@/lib/catalog-server';

export async function GET(request: NextRequest) {
  try {
    const access=await customerSession(); if ('error' in access) return access.error;
    const page=Number(request.nextUrl.searchParams.get('page') || 1),size=Number(request.nextUrl.searchParams.get('pageSize') || 12);
    if (!Number.isSafeInteger(page) || page<1 || page>10000 || !Number.isSafeInteger(size) || size<1 || size>50) return catalogError('INVALID_PAGE','Trang không hợp lệ.',400);
    const result=await access.client.rpc('pose_read_inquiries',{p_page:page,p_size:size});
    if (result.error) return discoveryError(result.error);
    return catalogJson(result.data);
  } catch { return catalogError('UNAVAILABLE','Chưa thể tải yêu cầu tư vấn.',503); }
}
export async function POST(request: NextRequest) {
  try {
    const access=await customerSession(request); if ('error' in access) return access.error;
    const parsed=await catalogInput(request); if ('error' in parsed) return parsed.error;
    const {data,key,fields}=inquiryInput(parsed.input);
    if (Object.keys(fields).length) return catalogError('INVALID_INPUT','Kiểm tra thông tin yêu cầu tư vấn.',400,fields);
    const result=await access.client.rpc('pose_submit_inquiry',{p_data:data,p_key:key});
    if (result.error) return discoveryError(result.error);
    return catalogJson(result.data,result.data.replayed ? 200:201);
  } catch { return catalogError('UNAVAILABLE','Chưa thể gửi yêu cầu. Hãy thử lại với cùng nội dung.',503); }
}
