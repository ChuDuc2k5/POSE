'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Building2, Heart, MapPin, Ruler, BedDouble, ArrowUpRight } from 'lucide-react';
import { availabilityLabels, priceLabel, propertyTypeLabels } from '@/lib/catalog';
import type { PublicProperty } from '@/lib/discovery';
import { catalogRequest } from '@/lib/catalog-client';

export function useFavoriteStatus(ids: string[], enabled=true) {
  const key=ids.join(',');
  const [status,setStatus]=useState<{key:string;ids:string[];customer:boolean;error?:string}>({key:'',ids:[],customer:false});
  useEffect(()=>{
    if (!key || !enabled) return;
    const controller=new AbortController();
    fetch(`/api/customer/favorites/status?ids=${encodeURIComponent(key)}`,{cache:'no-store',signal:controller.signal}).then(async response=>{
      if (response.status===401 || response.status===403) {setStatus({key,ids:[],customer:false});return;}
      if (!response.ok) throw new Error();
      const data=await response.json();setStatus({key,ids:data.ids,customer:true});
    }).catch(()=>{if(!controller.signal.aborted)setStatus({key,ids:[],customer:true,error:'Chưa thể tải yêu thích. Hãy tải lại trang.'});});
    return()=>controller.abort();
  },[key,enabled]);
  return { ...status,ready:status.key===key,has:(id:string)=>status.ids.includes(id) };
}
export function FavoriteButton({ id,saved,customer,ready=true,onChange }: { id:string;saved:boolean;customer:boolean;ready?:boolean;onChange?:()=>void }) {
  const [value,setValue]=useState<{saved:boolean}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const current=value?.saved ?? saved;
  async function change() {
    setBusy(true);setError('');
    try { await catalogRequest(`/api/customer/favorites/${id}`,{method:current ? 'DELETE':'PUT'});setValue({saved:!current});onChange?.(); }
    catch(e){setError(e instanceof Error ? e.message:'Chưa thể cập nhật yêu thích.');}
    finally {setBusy(false);}
  }
  return <div className="favorite-control">{!ready ? <button className="favorite-button" disabled aria-label="Đang tải yêu thích"><Heart size={18}/></button> : customer ? <button className={`favorite-button ${current ? 'is-saved':''}`} disabled={busy} aria-label={current ? 'Bỏ yêu thích':'Lưu yêu thích'} aria-pressed={current} onClick={change}><Heart size={18} fill={current ? 'currentColor':'none'}/></button> : <Link className="favorite-button" href="/sign-in" aria-label="Đăng nhập khách hàng để lưu yêu thích"><Heart size={18}/></Link>}{error && <span className="favorite-error" role="alert">{error}</span>}</div>;
}
export function PropertyCard({ item,saved=false,customer=false,ready=true,onFavoriteChange }: {item:PublicProperty;saved?:boolean;customer?:boolean;ready?:boolean;onFavoriteChange?:()=>void}) {
  const [imageFailed,setImageFailed]=useState(false);
  return <article className="discovery-card"><div className="discovery-card-image"><Link href={`/properties/${item.id}`} aria-label={`Xem ${item.name}`}>{item.cover_id && !imageFailed ? <Image src={`/api/catalog/media/${item.cover_id}?public=true`} alt={item.name} width={640} height={400} unoptimized onError={()=>setImageFailed(true)}/> : <div className="property-image-placeholder"><Building2 size={38}/><span>{item.project_name || 'Thông tin bất động sản'}</span></div>}</Link><span className={`availability-pill ${item.availability || ''}`}>{availabilityLabels[item.availability || 'Unavailable']}</span><FavoriteButton key={item.id} id={item.id} saved={saved} customer={customer} ready={ready} onChange={onFavoriteChange}/></div><div className="discovery-card-body"><span className="eyebrow">{propertyTypeLabels[item.property_type || 'Apartment']}</span><h3><Link href={`/properties/${item.id}`}>{item.name}</Link></h3><p className="property-location"><MapPin size={15}/>{item.location}</p><div className="property-specs"><span><Ruler size={15}/>{item.area?.toLocaleString('vi-VN')} m²</span>{item.bedrooms!=null && <span><BedDouble size={15}/>{item.bedrooms} phòng ngủ</span>}</div><div className="property-card-bottom"><strong>{priceLabel(item.price)}</strong><Link href={`/properties/${item.id}`} aria-label={`Chi tiết ${item.name}`}><ArrowUpRight size={20}/></Link></div></div></article>;
}
