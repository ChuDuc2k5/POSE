import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { backendFetch } from './backend';
import { allowsRole, roleHome, signedInHome, type Role } from './roles';
export const ACCESS_COOKIE = 'pose-access';
export const REFRESH_COOKIE = 'pose-refresh';
// One backend session lookup per request, shared by layouts and pages.
const sessionLookup = cache(async (writable: boolean) => {
  const response = await backendFetch(`/api/auth/session?writable=${writable}`);
  if (!response.ok) throw new Error('AUTH_UNAVAILABLE');
  return await response.json() as { user: { id: string; email?: string }; role: Role } | null;
});
export async function authenticatedSession({ writable = false }: { writable?: boolean } = {}) {
  return sessionLookup(writable);
}
export async function requirePageSession(path: string, roles?: readonly Role[]) {
  const session = await authenticatedSession({ writable: false });
  if (!session) {
    const jar = await cookies();
    if (jar.get(REFRESH_COOKIE)?.value) redirect(`/auth/refresh?next=${encodeURIComponent(path)}`);
    redirect('/sign-in');
  }
  if (roles && !allowsRole(session.role, roles)) redirect('/forbidden');
  return session;
}

// Guest entry pages must never render the public landing/auth screens for a
// verified signed-in account. Refresh cookies through the writable handler.
export async function redirectSignedInUser(path: '/' | '/sign-in' | '/sign-up') {
  const jar = await cookies();
  if (!jar.get(ACCESS_COOKIE)?.value && !jar.get(REFRESH_COOKIE)?.value) return;
  const session = await authenticatedSession({ writable: false });
  if (session) redirect(path === '/' ? roleHome(session.role) : signedInHome);
  if (jar.get(REFRESH_COOKIE)?.value) redirect(`/auth/refresh?next=${encodeURIComponent(path)}`);
}

export async function publicPageSession(path: string) {
  const jar = await cookies();
  if (!jar.get(ACCESS_COOKIE)?.value && !jar.get(REFRESH_COOKIE)?.value) return null;
  const session = await authenticatedSession({ writable: false });
  if (session) return session;
  if (jar.get(REFRESH_COOKIE)?.value) redirect(`/auth/refresh?next=${encodeURIComponent(path)}`);
  return null;
}

export async function publicPageRole(path: string): Promise<Role | null> {
  return (await publicPageSession(path))?.role ?? null;
}
