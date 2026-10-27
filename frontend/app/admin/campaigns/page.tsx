import { requirePageSession } from '@/lib/page-session';
import { CampaignWorkspace } from '@/components/campaign-workspace';
export default async function CampaignsPage() {
  await requirePageSession('/admin/campaigns', ['Admin']);
  return <CampaignWorkspace />;
}
