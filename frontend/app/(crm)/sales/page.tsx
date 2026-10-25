import type { Metadata } from 'next';
import { requireCrmSession } from '@/lib/crm-session';
import { CrmPage } from '@/components/crm/crm-workspace';
import { SalesWorkspace } from '@/components/sales/sales-workspace';
export const metadata: Metadata = { title: 'Không gian Sales | TERAVA', robots: { index: false, follow: false } };
export default async function SalesPage() {
  const identity = await requireCrmSession('/sales');
  return <CrmPage {...identity}><SalesWorkspace/></CrmPage>;
}
