import type { Metadata } from 'next';
import { PropertyBrowser } from '@/components/property-browser';
import { publicPageRole } from '@/lib/auth-server';

export const metadata: Metadata={title:'Khám phá bất động sản | NexCall'};
export default async function PropertiesPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const params=new URLSearchParams();
  for(const [key,value] of Object.entries(await searchParams))if(Array.isArray(value))for(const item of value)params.append(key,item);else if(value!==undefined)params.set(key,value);
  const role = await publicPageRole(`/properties${params.size ? `?${params}` : ''}`);
  return <PropertyBrowser key={params.toString()} initialQuery={params.toString()} role={role}/>;
}
