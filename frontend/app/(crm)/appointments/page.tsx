import { redirect } from 'next/navigation';
import { requireCrmSession } from '@/lib/crm-session';
// Kept so old links keep working: Sales use /sales/appointments, Admin uses /admin/appointments.
export default async function AppointmentsRedirectPage() {
  const identity = await requireCrmSession('/appointments');
  redirect(identity.role === 'Admin' ? '/admin/appointments' : '/sales/appointments');
}
