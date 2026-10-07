import { NextRequest } from 'next/server';
import { uuidPattern } from '@/lib/catalog';
import { customerSession, discoveryError } from '@/lib/discovery-server';
import { catalogError, catalogJson } from '@/lib/catalog-server';

export async function POST(request: NextRequest,context: RouteContext<'/api/customer/inquiries/[id]/confirm'>) {
  try {
    const access=await customerSession(request); if ('error' in access) return access.error;
    const {id}=await context.params;
    if (!uuidPattern.test(id)) return catalogError('NOT_FOUND','Không tìm thấy yêu cầu.',404);
    if ((await request.text()).trim()) return catalogError('INVALID_INPUT','Yêu cầu không cần dữ liệu bổ sung.',400);
    const result=await access.client.rpc('pose_confirm_inquiry',{p_id:id});
    if (result.error) return discoveryError(result.error);
    return catalogJson(result.data);
  } catch { return catalogError('UNAVAILABLE','Chưa thể kiểm tra xác minh yêu cầu.',503); }
}
