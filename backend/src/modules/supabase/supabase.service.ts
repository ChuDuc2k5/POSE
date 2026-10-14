import { createClient } from '@supabase/supabase-js';
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
export function authClient(access?: string) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('AUTH_NOT_CONFIGURED');
  return createClient(url,key,{ ...options, ...(access ? { global: { headers: { Authorization: `Bearer ${access}` } } } : {}) });
}
export function systemClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error('SYSTEM_NOT_CONFIGURED');
  return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,options);
}
export function storageClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_STORAGE_SECRET_KEY) throw new Error('STORAGE_NOT_CONFIGURED');
  return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_STORAGE_SECRET_KEY,options);
}
