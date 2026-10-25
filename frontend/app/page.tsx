import { unstable_rethrow } from 'next/navigation';
import { SystemHome } from "@/components/system-home";
import { publicPageSession } from '@/lib/page-session';
import { readProfile } from '@/lib/page-profile';

// The landing page must render for guests even when the session service is unreachable;
// Next's own redirects (expired access → /auth/refresh) still propagate.
const unlessRedirect = (error: unknown) => { unstable_rethrow(error); return null; };

export default async function Home() {
  const session = await publicPageSession('/').catch(unlessRedirect);
  const profile = session ? await readProfile().catch(unlessRedirect) : null;
  return <SystemHome role={session?.role ?? null} name={profile?.name}/>;
}
