import { backendFetch } from '@/lib/backend';
import { notFound } from 'next/navigation';
import { publicPageSession } from '@/lib/page-session';
import { uuidPattern } from '@/lib/catalog';
import { PropertyDetail } from '@/components/property-detail';
import type { PublicProperty } from '@/lib/discovery';
import { AiChatPage } from '@/components/ai-chat-provider';
import { PropertyCard } from '@/components/property-card';

function SimilarProperties({ items }: { items: PublicProperty[] }) {
  if (!items.length) return null;
  return (
    <section className="container property-similar property-content-panel">
      <h2>Căn tương tự</h2>
      <div className="discovery-product-grid">
        {items.slice(0, 4).map((item) => (
          <PropertyCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Chi tiết bất động sản | TERAVA' };
export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!uuidPattern.test(id)) notFound();
  const response = await backendFetch(`/api/catalog/properties/${id}`);
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('Chưa thể tải chi tiết sản phẩm.');
  const { item, media } = await response.json();
  const similarResponse = await backendFetch(`/api/properties/${id}/similar`);
  const similar = similarResponse.ok ? (await similarResponse.json()).items || [] : [];
  const session = await publicPageSession(`/properties/${id}`);
  const role = session?.role ?? null;
  return (
    <>
      <PropertyDetail
        returnTo={(await searchParams).returnTo as string | undefined}
        item={item as PublicProperty}
        media={media}
        role={role}
      />
      <SimilarProperties items={similar as PublicProperty[]} />
      <AiChatPage
        ownerKey={session?.user.id ?? 'guest'}
        signedIn={role === 'User'}
        propertyId={id}
        propertyName={item.name}
      />
    </>
  );
}
