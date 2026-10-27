import type { Metadata } from 'next';
import { requirePageSession } from '@/lib/page-session';
import { readProfile } from '@/lib/page-profile';
import { appointmentLocal } from '@/lib/appointments';
import { CrmPage, CrmWorkspace } from '@/components/crm/crm-workspace';
import { AppointmentWorkspace } from '@/components/appointments/appointment-workspace';
export const metadata: Metadata = { title: 'Lịch hẹn | TERAVA', robots: { index: false, follow: false } };
export default async function AdminAppointmentsPage() {
  const session = await requirePageSession('/admin/appointments', ['Admin']);
  const { name } = await readProfile();
  const identity = { userId: session.user.id, role: 'Admin' as const, name };
  return (
    <CrmWorkspace identity={identity} embedded>
      <CrmPage userId={identity.userId} role="Admin">
        <AppointmentWorkspace today={appointmentLocal(new Date().toISOString()).slice(0, 10)} />
      </CrmPage>
    </CrmWorkspace>
  );
}
