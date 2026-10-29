import { requirePageSession } from '@/lib/page-session';
import { CampaignWorkspace } from '@/components/campaign-workspace';
import { uuidPattern } from '@/lib/catalog';
import { notFound } from 'next/navigation';
export default async function CampaignPage({ params }: PageProps<'/admin/campaigns/[id]'>) {
  const { id } = await params;
  await requirePageSession(`/admin/campaigns/${id}`, ['Admin']);
  if (!uuidPattern.test(id)) notFound();
  return <CampaignWorkspace id={id} />;
}
