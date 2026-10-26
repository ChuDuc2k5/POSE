import type { Metadata } from 'next';
import { requireCrmSession } from '@/lib/crm-session';
import { vietnamToday } from '@/lib/reports';
import { CrmPage } from '@/components/crm/crm-workspace';
import { ReportWorkspace } from '@/components/reports/report-workspace';
export const metadata: Metadata = { title: 'Báo cáo Lead | TERAVA', robots: { index: false, follow: false } };
export default async function ReportsPage() {
  const identity = await requireCrmSession('/reports');
  return <CrmPage {...identity}><ReportWorkspace today={vietnamToday()}/></CrmPage>;
}
