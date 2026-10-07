import { NextRequest } from 'next/server';
import { customerSession, discoveryError } from '@/lib/discovery-server';
import { catalogError, catalogJson } from '@/lib/catalog-server';

export async function GET(request: NextRequest) {
  try {
    const access=await customerSession(); if ('error' in access) return access.error;
    const page=Number(request.nextUrl.searchParams.get('page') || 1),size=Number(request.nextUrl.searchParams.get('pageSize') || 12);
    if (!Number.isSafeInteger(page) || page<1 || page>10000 || !Number.isSafeInteger(size) || size<1 || size>50) return catalogError('INVALID_PAGE','Trang không hợp lệ.',400);
    const result=await access.client.rpc('pose_read_favorites',{p_page:page,p_size:size});
    if (result.error) return discoveryError(result.error);
    return catalogJson(result.data);
  } catch { return catalogError('UNAVAILABLE','Chưa thể tải danh sách yêu thích.',503); }
}
