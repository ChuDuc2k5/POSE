import type { User } from '@supabase/supabase-js';
import { authClient } from './session.js';

export async function ensureGoogleProfile(access: string, user: User) {
  const client = authClient(access);
  const existing = await client.from('account_profiles').select('user_id').eq('user_id', user.id).maybeSingle();
  if (existing.error) throw new Error('PROFILE_UNAVAILABLE');
  if (existing.data) return;
  // Provider metadata is display-only, never an authorization source. Preserve
  // every existing profile; this initializes only a missing profile.
  const metadata = user.user_metadata || {};
  const candidate: unknown = [metadata.display_name, metadata.full_name, metadata.name]
    .find(value => typeof value === 'string' && value.trim().length >= 2);
  const name = typeof candidate === 'string' ? Array.from(candidate.trim()).filter(character => {
    const code = character.codePointAt(0)!;
    return code >= 32 && code !== 127;
  }).slice(0, 80).join('') : 'Khách hàng';
  const result = await client.rpc('pose_update_profile', { p_changes: { name: name.length >= 2 ? name : 'Khách hàng' }, p_version: 0 });
  // A concurrent profile update wins. Never retry it with an overwrite.
  if (result.error && result.error.code !== '40001') throw new Error('PROFILE_UNAVAILABLE');
}
