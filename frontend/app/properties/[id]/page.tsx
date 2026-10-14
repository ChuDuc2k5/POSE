import { notFound } from 'next/navigation';
import { authClient, publicPageRole } from '@/lib/auth-server';
import { uuidPattern } from '@/lib/catalog';
import { PropertyDetail } from '@/components/property-detail';
import type { PublicProperty } from '@/lib/discovery';

export const dynamic='force-dynamic';
export const metadata={title:'Chi tiết bất động sản | NexCall'};
export default async function PropertyPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;if(!uuidPattern.test(id))notFound();
  const client=authClient();
  const property=await client.from('property_public_catalog').select('*').eq('id',id).maybeSingle();
  if(property.error)throw new Error('Chưa thể tải chi tiết sản phẩm.');
  if(!property.data)notFound();
  const media=await client.from('property_media').select('id,name,media_type,sort_order').eq('property_id',id).eq('visibility','Public').eq('visible',true).eq('removed',false).order('sort_order').order('id');
  if(media.error)throw new Error('Chưa thể tải tài liệu sản phẩm.');
  const role = await publicPageRole(`/properties/${id}`);
  return <PropertyDetail item={property.data as PublicProperty} media={media.data} role={role}/>;
}
