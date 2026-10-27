import { requirePageSession } from '@/lib/page-session';
import { CatalogWorkspace } from '@/components/catalog-workspace';
import { AiWorkspace } from '@/components/ai-workspace';
import Link from 'next/link';

export default async function AdminPage() {
  await requirePageSession('/admin', ['Admin']);
  return (
    <>
      <CatalogWorkspace />
      <AiWorkspace admin />
      <section className="ai-dashboard-teaser ai-usage-panel">
        <div>
          <p className="eyebrow">TERAVA AI</p>
          <h2>AI Platform Dashboard</h2>
          <p>Theo dõi chi phí, tốc độ và hiệu quả các lượt gọi AI.</p>
        </div>
        <Link className="button primary" href="/admin/ai-dashboard">
          Mở dashboard AI
        </Link>
      </section>
    </>
  );
}
