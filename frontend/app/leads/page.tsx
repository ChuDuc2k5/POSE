import type { Metadata } from 'next';
import { requirePageSession } from '@/lib/page-session';
import { readProfile } from '@/lib/page-profile';
import { LeadWorkspace } from '@/components/leads/lead-workspace';

export const metadata: Metadata = { title: 'Quản lý Lead | TERAVA', robots: { index: false, follow: false } };
export default async function LeadsPage() {
  const session = await requirePageSession('/leads', ['Admin', 'Sales']);
  const profile = await readProfile();
  return <LeadWorkspace role={session.role as 'Admin' | 'Sales'} name={profile.name}/>;
}
