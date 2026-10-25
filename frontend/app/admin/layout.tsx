import { requirePageSession } from '@/lib/page-session';
import { readProfile } from '@/lib/page-profile';
import { AdminShell } from '@/components/admin-shell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePageSession('/admin', ['Admin']);
  const profile = await readProfile();
  return <AdminShell name={profile.name}>{children}</AdminShell>;
}
