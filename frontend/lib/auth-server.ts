import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createHash } from 'node:crypto';
import { redirect } from 'next/navigation';
import { allowsRole, roleHome, type Role } from './roles';

export const ACCESS_COOKIE = 'pose-access';
export const REFRESH_COOKIE = 'pose-refresh';

export function authClient(access?: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('AUTH_NOT_CONFIGURED');
  return createClient(url, key, { ...(access ? { global: { headers: { Authorization: `Bearer ${access}` } } } : {}), auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export async function saveSession(session: { access_token: string; refresh_token: string; expires_in: number }) {
  const jar = await cookies();
  const options = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
  jar.set(ACCESS_COOKIE, session.access_token, { ...options, maxAge: session.expires_in });
  jar.set(REFRESH_COOKIE, session.refresh_token, { ...options, maxAge: 60 * 60 * 24 * 7 });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

async function accessContext(access: string, userId: string) {
  const { data, error } = await authClient(access).rpc('pose_access_context');
  if (error) throw new Error('AUTHORIZATION_UNAVAILABLE');
  if (!data || data.user_id !== userId || !data.active || !data.session_valid) return null;
  if (!['User', 'Sales', 'Admin'].includes(data.role)) return null;
  return data.role as Role;
}

export async function authenticatedSession({ writable = true }: { writable?: boolean } = {}) {
  const jar = await cookies();
  const client = authClient();
  const access = jar.get(ACCESS_COOKIE)?.value;
  if (access) {
    const { data, error } = await client.auth.getUser(access);
    if (error && (!error.status || error.status === 429 || error.status >= 500)) throw new Error('AUTH_UNAVAILABLE');
    if (!error && data.user?.email_confirmed_at) {
      const role = await accessContext(access, data.user.id);
      if (role) return { user: data.user, access, role };
      if (writable) await clearSession();
      return null;
    }
  }
  // Server Components cannot write cookies. Refresh through a Route Handler.
  if (!writable) return null;
  const refresh = jar.get(REFRESH_COOKIE)?.value;
  if (refresh) {
    const { data, error } = await client.auth.refreshSession({ refresh_token: refresh });
    if (!error && data.session && data.user?.email_confirmed_at) {
      const role = await accessContext(data.session.access_token, data.user.id);
      if (!role) { await clearSession(); return null; }
      await saveSession(data.session);
      return { user: data.user, access: data.session.access_token, role };
    }
    if (error && (!error.status || error.status === 429 || error.status >= 500)) throw new Error('AUTH_UNAVAILABLE');
  }
  await clearSession();
  return null;
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
  if (session) redirect(roleHome(session.role));
  if (jar.get(REFRESH_COOKIE)?.value) redirect(`/auth/refresh?next=${encodeURIComponent(path)}`);
}

export async function publicPageRole(path: string): Promise<Role | null> {
  const jar = await cookies();
  if (!jar.get(ACCESS_COOKIE)?.value && !jar.get(REFRESH_COOKIE)?.value) return null;
  const session = await authenticatedSession({ writable: false });
  if (session) return session.role;
  if (jar.get(REFRESH_COOKIE)?.value) redirect(`/auth/refresh?next=${encodeURIComponent(path)}`);
  return null;
}

// Single-process local limit. Provider-side limits remain required in production.
const attempts = new Map<string, { count: number; expires: number }>();
export function consumeAttempt(scope: string, email: string, limit: number) {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.expires <= now) attempts.delete(key);
  const key = createHash('sha256').update(`${scope}:${email}`).digest('hex');
  const entry = attempts.get(key) ?? { count: 0, expires: now + 15 * 60 * 1000 };
  if (entry.count >= limit || attempts.size > 10000) return false;
  entry.count++;
  attempts.set(key, entry);
  return true;
}

export function resetAttempts(email: string) {
  attempts.delete(createHash('sha256').update(`signin:${email}`).digest('hex'));
}
