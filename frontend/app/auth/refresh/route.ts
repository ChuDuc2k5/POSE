import { NextRequest, NextResponse } from 'next/server';
import { authenticatedSession } from '@/lib/auth-server';
import { roleHome } from '@/lib/roles';

const guestEntries = new Set(['/', '/sign-in', '/sign-up']);
const destinations = new Set([...guestEntries, '/account', '/customer', '/customer/favorites', '/customer/inquiries', '/customer/inquiries/new', '/sales', '/admin']);
export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get('next') || '';
  const catalogDestination = /^\/properties(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?(?:\?[^#]*)?$/i.test(requested);
  const next = destinations.has(requested) || catalogDestination ? requested : null;
  try {
    const session = await authenticatedSession();
    const destination = session
      ? next && !guestEntries.has(next) ? next : roleHome(session.role)
      : next && (guestEntries.has(next) || catalogDestination) ? next : '/sign-in';
    const response = NextResponse.redirect(new URL(destination, request.url));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return new NextResponse('Dịch vụ tài khoản tạm thời chưa khả dụng. Vui lòng tải lại trang.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
