import { requirePageSession } from '@/lib/auth-server';
import { CatalogWorkspace } from '@/components/catalog-workspace';
import { readProfile } from '@/lib/account-server';
import { AiWorkspace } from '@/components/ai-workspace';

export default async function AdminPage() {
  const session = await requirePageSession('/admin', ['Admin']);
  return <><CatalogWorkspace name={(await readProfile(session.access)).name}/><AiWorkspace admin/></>;
}
