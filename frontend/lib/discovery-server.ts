import 'server-only';
import { NextRequest } from 'next/server';
import { authenticatedSession, authClient } from './auth-server';
import { catalogDatabaseError, catalogError } from './catalog-server';

export async function customerSession(request?: NextRequest) {
  if (request && request.headers.get('origin')!==request.nextUrl.origin) return { error:catalogError('INVALID_ORIGIN','Yêu cầu không hợp lệ.',403) } as const;
  const session=await authenticatedSession();
  if (!session) return { error:catalogError('UNAUTHORIZED','Vui lòng đăng nhập tài khoản khách hàng.',401) } as const;
  if (session.role!=='User') return { error:catalogError('FORBIDDEN','Chức năng này dành cho tài khoản khách hàng.',403) } as const;
  return { session,client:authClient(session.access) } as const;
}
export function discoveryError(error: { code?: string; message?: string }) {
  if (error.message?.includes('SEARCH_BUSY')) return catalogError('SEARCH_BUSY','Tìm kiếm đang có nhiều lượt truy cập. Vui lòng thử lại sau.',503);
  if (error.message?.includes('SEARCH_') && error.code==='40001') return catalogError('SEARCH_EXPIRED','Danh mục đã thay đổi hoặc phiên tìm kiếm hết hạn. Vui lòng tìm lại.',409);
  if (error.message?.includes('IDEMPOTENCY_CONFLICT')) return catalogError('REQUEST_CONFLICT','Mã yêu cầu đã được sử dụng với nội dung khác.',409);
  if (error.code==='53300') return catalogError('RATE_LIMIT','Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.',429);
  if (error.message?.includes('FILTER_TOO_BROAD')) return catalogError('FILTER_TOO_BROAD','Vui lòng thêm bộ lọc để thu hẹp kết quả.',400);
  return catalogDatabaseError(error);
}
