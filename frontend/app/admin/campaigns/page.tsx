import { requirePageSession } from '@/lib/auth-server';
import { CampaignWorkspace } from '@/components/campaign-workspace';
export default async function CampaignsPage(){await requirePageSession('/admin/campaigns',['Admin']);return <CampaignWorkspace/>;}
