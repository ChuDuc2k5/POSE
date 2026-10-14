import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';

// System/AI actor. Only for RPCs granted to service_role (pose_system_*);
// never use it to read data on behalf of a signed-in user.
export function systemClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('SYSTEM_NOT_CONFIGURED');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

// Scheduler/worker endpoints are triggered with `Authorization: Bearer $CRON_SECRET`.
export function cronAuthorized(header: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7)), expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
