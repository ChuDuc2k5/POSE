import { redirect } from 'next/navigation';
import { requireCrmSession } from '@/lib/crm-session';
// Kept so old links keep working: Sales use /sales/leads, Admin uses /admin/leads.
export default async function LeadsRedirectPage() {
  const identity = await requireCrmSession('/leads');
  redirect(identity.role === 'Admin' ? '/admin/leads' : '/sales/leads');
}
