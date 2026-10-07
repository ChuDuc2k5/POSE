import { requirePageSession } from '@/lib/auth-server';
import { WorkspaceEntry } from '@/components/workspace-entry';
import { readProfile } from '@/lib/account-server';

export default async function SalesPage() {
  const session = await requirePageSession('/sales', ['Sales', 'Admin']);
  return <WorkspaceEntry role={session.role} name={(await readProfile(session.access)).name}/>;
}
