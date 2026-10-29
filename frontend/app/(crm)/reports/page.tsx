import { redirect } from 'next/navigation';
import { requireCrmSession } from '@/lib/crm-session';
// Kept so old links keep working: Sales use /sales/reports, Admin uses /admin/reports.
export default async function ReportsRedirectPage() {
  const identity = await requireCrmSession('/reports');
  redirect(identity.role === 'Admin' ? '/admin/reports' : '/sales/reports');
}
