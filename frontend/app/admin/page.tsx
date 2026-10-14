import { requirePageSession } from '@/lib/page-session';
import { CatalogWorkspace } from '@/components/catalog-workspace';
import { readProfile } from '@/lib/page-profile';

export default async function AdminPage() {
  await requirePageSession('/admin', ['Admin']);
  return <CatalogWorkspace name={(await readProfile()).name}/>;
}
