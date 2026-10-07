import { NextRequest, NextResponse } from 'next/server';
import { authenticatedSession } from '@/lib/auth-server';

export async function GET(_request: NextRequest, context: { params: Promise<{ role: string }> }) {
  const { role } = await context.params;
  const json = (body: object, status: number) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!['admin', 'sales'].includes(role)) return json({ message: 'Không tìm thấy chức năng.' }, 404);
  try {
    const session = await authenticatedSession();
    if (!session) return json({ message: 'Vui lòng đăng nhập.' }, 401);
    if (session.role !== 'Admin' && !(role === 'sales' && session.role === 'Sales')) return json({ message: 'Bạn không có quyền truy cập.' }, 403);
    const backend = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const response = await fetch(`${backend}/auth/${role}`, { headers: { Authorization: `Bearer ${session.access}` }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) return json({ message: response.status === 403 ? 'Bạn không có quyền truy cập.' : 'Không thể xác nhận quyền truy cập.' }, response.status >= 500 ? 503 : response.status);
    return json(await response.json(), 200);
  } catch { return json({ message: 'Dịch vụ xác thực chưa khả dụng.' }, 503); }
}
