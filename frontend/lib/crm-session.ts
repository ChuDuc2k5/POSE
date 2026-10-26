import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticatedSession, REFRESH_COOKIE } from './page-session';

// Request-scoped only: the layout and page share one authorization lookup.
export const readCrmSession = cache(() => authenticatedSession({ writable: false }));
export async function requireCrmSession(path: '/leads' | '/sales' | '/reports' | '/appointments' | '/sales/leads' | '/sales/reports' | '/sales/appointments') {
  const session = await readCrmSession();
  if (!session) {
    if ((await cookies()).get(REFRESH_COOKIE)?.value) redirect('/auth/refresh?next=' + encodeURIComponent(path));
    redirect('/sign-in');
  }
  if (session.role !== 'Admin' && session.role !== 'Sales') redirect('/forbidden');
  return { userId: session.user.id, role: session.role };
}
