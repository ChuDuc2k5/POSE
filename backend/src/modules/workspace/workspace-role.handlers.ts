import { WebRequest, WebResponse } from '../../common/http.js';
import { authenticatedSession } from '../auth/session.js';

export async function GET(_request: WebRequest, context: { params: Promise<{ role: string }> }) {
  const { role } = await context.params;
  const json = (body: object, status: number) =>
    WebResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!['admin', 'sales'].includes(role)) return json({ message: 'Không tìm thấy chức năng.' }, 404);
  try {
    const session = await authenticatedSession();
    if (!session) return json({ message: 'Vui lòng đăng nhập.' }, 401);
    if (session.role !== 'Admin' && !(role === 'sales' && session.role === 'Sales'))
      return json({ message: 'Bạn không có quyền truy cập.' }, 403);
    return json(
      {
        role: session.role,
        message:
          role === 'admin' ? 'Bạn có quyền truy cập không gian quản trị.' : 'Bạn có quyền truy cập không gian tư vấn.',
      },
      200,
    );
  } catch {
    return json({ message: 'Dịch vụ xác thực chưa khả dụng.' }, 503);
  }
}
