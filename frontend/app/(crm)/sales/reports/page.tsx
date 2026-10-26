import type { Metadata } from 'next';
import { requireCrmSession } from '@/lib/crm-session';
import { CrmPage } from '@/components/crm/crm-workspace';
import { vietnamToday } from '@/lib/reports';
import { ReportWorkspace } from '@/components/reports/report-workspace';
export const metadata: Metadata = { title: 'Báo cáo Lead | TERAVA', robots: { index: false, follow: false } };
export default async function SalesReportsPage() {
  const identity = await requireCrmSession('/sales/reports');
  return <CrmPage {...identity}><ReportWorkspace today={vietnamToday()}/></CrmPage>;
}
