import { requirePageSession } from '@/lib/page-session';
import { CatalogWorkspace } from '@/components/catalog-workspace';
import { readProfile } from '@/lib/page-profile';
import { AiWorkspace } from '@/components/ai-workspace';
import { AiUsagePanel } from '@/components/ai-usage-panel';

export default async function AdminPage() {
  await requirePageSession('/admin', ['Admin']);
  return <><CatalogWorkspace name={(await readProfile()).name}/><AiWorkspace admin/><AiUsagePanel/></>;
}
