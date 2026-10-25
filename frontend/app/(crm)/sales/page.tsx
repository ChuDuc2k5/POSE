import type { Metadata } from 'next';
import { requireCrmSession } from '@/lib/crm-session';
import { CrmPage } from '@/components/crm/crm-workspace';
import { SalesWorkspace } from '@/components/sales/sales-workspace';
import { CallsWorkspace } from '@/components/calls-workspace';
import { AiWorkspace } from '@/components/ai-workspace';
export const metadata: Metadata = { title: 'Không gian Sales | TERAVA', robots: { index: false, follow: false } };
export default async function SalesPage() {
  const identity = await requireCrmSession('/sales');
  return <CrmPage {...identity}><SalesWorkspace extra={<section className="calls-sales-workspace crm-sales-calls" aria-label="Cuộc gọi và trợ lý AI"><CallsWorkspace sales/><AiWorkspace/></section>}/></CrmPage>;
}
