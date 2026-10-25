import { WebRequest, WebResponse } from '../../common/http.js';
import { authenticatedSession } from './session.js';
import { roleHome } from '../../common/roles.js';

const guestEntries = new Set(['/', '/sign-in', '/sign-up']);
const publicDestinations = new Set(['/consultation','/guest/inquiries']);
const destinations = new Set([...guestEntries,...publicDestinations, '/account', '/customer', '/customer/favorites', '/customer/inquiries', '/customer/inquiries/new', '/sales', '/admin','/admin/inquiries']);
export async function GET(request: WebRequest) {
  const requested = request.nextUrl.searchParams.get('next') || '';
  const catalogDestination = /^\/properties(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?(?:\?[^#]*)?$/i.test(requested);
  const next = destinations.has(requested) || catalogDestination ? requested : null;
  try {
    const session = await authenticatedSession();
    const destination = session
      ? next && !guestEntries.has(next) ? next : roleHome(session.role)
      : next && (guestEntries.has(next) || publicDestinations.has(next) || catalogDestination) ? next : '/sign-in';
    const response = WebResponse.redirect(new URL(destination, request.url));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return new WebResponse('Dịch vụ tài khoản tạm thời chưa khả dụng. Vui lòng tải lại trang.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
