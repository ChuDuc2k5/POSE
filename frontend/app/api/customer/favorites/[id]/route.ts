import { NextRequest } from 'next/server';
import { uuidPattern } from '@/lib/catalog';
import { customerSession, discoveryError } from '@/lib/discovery-server';
import { catalogError, catalogJson } from '@/lib/catalog-server';

async function change(request: NextRequest,context: RouteContext<'/api/customer/favorites/[id]'>,saved: boolean) {
  try {
    const access=await customerSession(request); if ('error' in access) return access.error;
    const {id}=await context.params;
    if (!uuidPattern.test(id)) return catalogError('NOT_FOUND','Không tìm thấy sản phẩm.',404);
    if ((await request.text()).trim()) return catalogError('INVALID_INPUT','Yêu cầu không cần dữ liệu bổ sung.',400);
    const result=await access.client.rpc('pose_set_favorite',{p_property:id,p_saved:saved});
    if (result.error) return discoveryError(result.error);
    return catalogJson(result.data);
  } catch { return catalogError('UNAVAILABLE','Chưa thể cập nhật yêu thích.',503); }
}
export async function PUT(request: NextRequest,context: RouteContext<'/api/customer/favorites/[id]'>) { return change(request,context,true); }
export async function DELETE(request: NextRequest,context: RouteContext<'/api/customer/favorites/[id]'>) { return change(request,context,false); }
