import { requirePageSession } from '@/lib/page-session';
import { AiDashboard } from '@/components/ai-dashboard';

export default async function AiDashboardPage() {
  await requirePageSession('/admin/ai-dashboard', ['Admin']);
  return <AiDashboard />;
}
