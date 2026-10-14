import { requirePageSession } from '@/lib/page-session';
import { WorkspaceEntry } from '@/components/workspace-entry';
import { readProfile } from '@/lib/page-profile';

export default async function SalesPage() {
  const session = await requirePageSession('/sales', ['Sales', 'Admin']);
  return <WorkspaceEntry role={session.role} name={(await readProfile()).name}/>;
}
