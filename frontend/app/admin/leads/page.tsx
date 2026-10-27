import type { Metadata } from 'next';
import { requirePageSession } from '@/lib/page-session';
import { readProfile } from '@/lib/page-profile';
import { CrmPage, CrmWorkspace } from '@/components/crm/crm-workspace';
import { LeadWorkspace } from '@/components/leads/lead-workspace';
export const metadata: Metadata = { title: 'Quản lý Lead | TERAVA', robots: { index: false, follow: false } };
export default async function AdminLeadsPage() {
  const session = await requirePageSession('/admin/leads', ['Admin']);
  const { name } = await readProfile();
  const identity = { userId: session.user.id, role: 'Admin' as const, name };
  return (
    <CrmWorkspace identity={identity} embedded>
      <CrmPage userId={identity.userId} role="Admin">
        <LeadWorkspace />
      </CrmPage>
    </CrmWorkspace>
  );
}
