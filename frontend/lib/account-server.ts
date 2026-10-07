import 'server-only';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import { authClient, clearSession } from './auth-server';

export type Profile = {
  name: string; phone: string; phoneVerified: boolean; notificationsEnabled: boolean;
  avatarPath: string | null; avatarUrl?: string | null; version: number; updatedAt: string | null;
};

export async function readProfile(access: string): Promise<Profile> {
  const client = authClient(access);
  const { data, error } = await client.rpc('pose_read_profile');
  if (error || !data) throw new Error('PROFILE_UNAVAILABLE');
  return withAvatar(access, data);
}

export async function withAvatar(access: string, profile: Profile): Promise<Profile> {
  if (!profile.avatarPath) return { ...profile, avatarUrl: null };
  const { data, error } = await authClient(access).storage.from('account-avatars').createSignedUrl(profile.avatarPath, 300);
  if (error) throw new Error('AVATAR_UNAVAILABLE');
  return { ...profile, avatarUrl: data.signedUrl };
}

// Supabase updateUser requires an SDK session; the application's tokens live in
// HttpOnly cookies, so call the authenticated Auth endpoint from this server.
export async function updateIdentity(access: string, attributes: { password?: string; phone?: string }) {
  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    method: 'PUT', headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY!, Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(attributes), cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  return { ok: response.ok, status: response.status, user: response.ok ? await response.json() as User : null };
}

const RECOVERY_ACCESS = 'pose-recovery-access';
const RECOVERY_REFRESH = 'pose-recovery-refresh';
export async function beginRecovery(session: { access_token: string; refresh_token: string }) {
  const { data, error } = await authClient(session.access_token).rpc('pose_recovery_ticket', { p_action: 'begin' });
  if (error || data !== true) throw new Error('RECOVERY_INVALID');
  await clearSession();
  const jar = await cookies();
  const options = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: 600 };
  jar.set(RECOVERY_ACCESS, session.access_token, options);
  jar.set(RECOVERY_REFRESH, session.refresh_token, options);
}

export async function recoverySession() {
  const jar = await cookies();
  const access = jar.get(RECOVERY_ACCESS)?.value;
  if (!access) return null;
  const client = authClient(access);
  const { data, error } = await client.auth.getUser(access);
  if (error && (!error.status || error.status >= 500 || error.status === 429)) throw new Error('RECOVERY_UNAVAILABLE');
  if (error || !data.user?.email_confirmed_at) return null;
  const ticket = await client.rpc('pose_recovery_ticket', { p_action: 'check' });
  if (ticket.error?.code === '42501') return null;
  if (ticket.error) throw new Error('RECOVERY_UNAVAILABLE');
  return ticket.data === true ? { access, user: data.user } : null;
}

export async function clearRecovery() {
  const jar = await cookies();
  jar.delete(RECOVERY_ACCESS); jar.delete(RECOVERY_REFRESH);
}
