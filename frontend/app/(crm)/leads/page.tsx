import type { Metadata } from 'next';
import { requireCrmSession } from '@/lib/crm-session';
import { CrmPage } from '@/components/crm/crm-workspace';
import { LeadWorkspace } from '@/components/leads/lead-workspace';
export const metadata: Metadata = { title: 'Quản lý Lead | TERAVA', robots: { index: false, follow: false } };
export default async function LeadsPage() {
  const identity = await requireCrmSession('/leads');
  return <CrmPage {...identity}><LeadWorkspace/></CrmPage>;
}
