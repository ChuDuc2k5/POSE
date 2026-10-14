import 'server-only';
import { backendFetch } from './backend';
import type { Profile } from './profile';
export async function readProfile(): Promise<Profile> {
  const response = await backendFetch('/api/account/profile');
  if (!response.ok) throw new Error('PROFILE_UNAVAILABLE');
  return (await response.json()).profile;
}
