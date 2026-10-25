import 'server-only';
import { cache } from 'react';
import { backendFetch } from './backend';
import type { Profile } from './profile';
export const readProfile = cache(async (): Promise<Profile> => {
  const response = await backendFetch('/api/account/profile');
  if (!response.ok) throw new Error('PROFILE_UNAVAILABLE');
  return (await response.json()).profile;
});
