import type { Metadata } from 'next';
import { requireCrmSession } from '@/lib/crm-session';
import { CrmPage } from '@/components/crm/crm-workspace';
import { appointmentLocal } from '@/lib/appointments';
import { AppointmentWorkspace } from '@/components/appointments/appointment-workspace';
export const metadata: Metadata = { title: 'Lịch hẹn | TERAVA', robots: { index: false, follow: false } };
export default async function SalesAppointmentsPage() {
  const identity = await requireCrmSession('/sales/appointments');
  return (
    <CrmPage {...identity}>
      <AppointmentWorkspace today={appointmentLocal(new Date().toISOString()).slice(0, 10)} />
    </CrmPage>
  );
}
