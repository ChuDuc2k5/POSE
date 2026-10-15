import { backendFetch } from '@/lib/backend';
import { notFound } from 'next/navigation';
import { publicPageSession } from '@/lib/page-session';
import { uuidPattern } from '@/lib/catalog';
import { PropertyDetail } from '@/components/property-detail';
import type { PublicProperty } from '@/lib/discovery';
import { AiChatPage } from '@/components/ai-chat-provider';

export const dynamic='force-dynamic';
export const metadata={title:'Chi tiết bất động sản | TERAVA'};
export default async function PropertyPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;if(!uuidPattern.test(id))notFound();
  const response = await backendFetch(`/api/catalog/properties/${id}`);
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('Chưa thể tải chi tiết sản phẩm.');
  const { item, media } = await response.json();
  const session = await publicPageSession(`/properties/${id}`);
  const role=session?.role ?? null;
  return <><PropertyDetail item={item as PublicProperty} media={media} role={role}/><AiChatPage ownerKey={session?.user.id ?? 'guest'} signedIn={role==='User'} propertyId={id} propertyName={item.name}/></>;
}
