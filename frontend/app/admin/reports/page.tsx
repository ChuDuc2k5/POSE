import type { Metadata } from 'next';
import { requirePageSession } from '@/lib/page-session';
import { readProfile } from '@/lib/page-profile';
import { vietnamToday } from '@/lib/reports';
import { CrmPage, CrmWorkspace } from '@/components/crm/crm-workspace';
import { ReportWorkspace } from '@/components/reports/report-workspace';
export const metadata: Metadata = { title: 'Báo cáo Lead | TERAVA', robots: { index: false, follow: false } };
export default async function AdminReportsPage() {
  const session = await requirePageSession('/admin/reports', ['Admin']);
  const { name } = await readProfile();
  const identity = { userId: session.user.id, role: 'Admin' as const, name };
  return <CrmWorkspace identity={identity} embedded><CrmPage userId={identity.userId} role="Admin"><ReportWorkspace today={vietnamToday()}/></CrmPage></CrmWorkspace>;
}
