import { NextRequest } from 'next/server';
import { uuidPattern } from '@/lib/catalog';
import { customerSession, discoveryError } from '@/lib/discovery-server';
import { catalogError, catalogJson } from '@/lib/catalog-server';

export async function GET(request: NextRequest) {
  try {
    const access=await customerSession(); if ('error' in access) return access.error;
    const ids=(request.nextUrl.searchParams.get('ids') || '').split(',');
    if (ids.length>50 || ids.some(id=>!uuidPattern.test(id))) return catalogError('INVALID_INPUT','Danh sách sản phẩm không hợp lệ.',400);
    const result=await access.client.from('customer_property_favorites').select('property_id').eq('user_id',access.session.user.id).in('property_id',ids);
    if (result.error) return discoveryError(result.error);
    return catalogJson({ids:result.data.map(row=>row.property_id)});
  } catch { return catalogError('UNAVAILABLE','Chưa thể tải trạng thái yêu thích.',503); }
}
