import type { Metadata } from 'next';
import { PropertyBrowser } from '@/components/property-browser';
import { publicPageSession } from '@/lib/page-session';
import { AiChatPage } from '@/components/ai-chat-provider';

export const metadata: Metadata = { title: 'Khám phá bất động sản | TERAVA' };
export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams))
    if (Array.isArray(value)) for (const item of value) params.append(key, item);
    else if (value !== undefined) params.set(key, value);
  const session = await publicPageSession(`/properties${params.size ? `?${params}` : ''}`);
  const role = session?.role ?? null;
  return (
    <>
      <PropertyBrowser key={params.toString()} initialQuery={params.toString()} role={role} />
      <AiChatPage ownerKey={session?.user.id ?? 'guest'} signedIn={role === 'User'} />
    </>
  );
}
