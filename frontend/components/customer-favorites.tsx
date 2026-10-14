'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { SiteHeader } from './site-header';
import type { Role } from '@/lib/roles';
import { CustomerNav } from './customer-nav';
import { PropertyCard } from './property-card';
import type { Favorite } from '@/lib/discovery';
import { catalogRequest } from '@/lib/catalog-client';

export function CustomerFavorites({role}:{role:Role}){
  const [data,setData]=useState<{items:Favorite[];total:number}|null>(null),[error,setError]=useState(''),[page,setPage]=useState(1),[attempt,setAttempt]=useState(0),[busy,setBusy]=useState(true),[removing,setRemoving]=useState<string|null>(null);
  useEffect(()=>{const controller=new AbortController();catalogRequest<{items:Favorite[];total:number}>(`/api/customer/favorites?page=${page}&pageSize=12`,{signal:controller.signal}).then(result=>{setData(result);setError('');}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error ? e.message:'Chưa thể tải yêu thích.');}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});return()=>controller.abort();},[page,attempt]);
  function reload(){setBusy(true);if(data?.items.length===1 && page>1)setPage(page-1);else setAttempt(attempt+1);}
  async function remove(id:string){setRemoving(id);try{await catalogRequest(`/api/customer/favorites/${id}`,{method:'DELETE'});reload();}catch(e){setError(e instanceof Error ? e.message:'Chưa thể bỏ lưu.');}finally{setRemoving(null);}}
  return <><SiteHeader role={role}/><main className="discovery-main container"><CustomerNav active="favorites"/><div className="discovery-heading"><span className="eyebrow">SẢN PHẨM BẠN QUAN TÂM</span><h1>Danh sách yêu thích</h1><p>Lưu các bất động sản phù hợp để xem lại khi cần.</p></div>{busy ? <p className="customer-empty" role="status">Đang tải yêu thích…</p> : error ? <div className="customer-empty" role="alert"><p>{error}</p><button className="button secondary" onClick={()=>{setBusy(true);setAttempt(attempt+1);}}>Thử lại</button></div> : data?.items.length ? <><div className="customer-product-grid">{data.items.map(favorite=>favorite.property ? <PropertyCard key={favorite.property_id} item={favorite.property} saved customer onFavoriteChange={reload}/> : <article key={favorite.property_id} className="unavailable-favorite"><Heart size={28}/><h2>Sản phẩm không còn khả dụng</h2><p>Sản phẩm đã được ẩn hoặc lưu trữ. Bạn vẫn có thể bỏ khỏi danh sách yêu thích.</p><button className="button secondary" disabled={removing===favorite.property_id} onClick={()=>remove(favorite.property_id)}>Bỏ yêu thích</button></article>)}</div><div className="discovery-pagination"><button className="button secondary" disabled={page===1} onClick={()=>{setBusy(true);setPage(page-1);}}>Trang trước</button><span>Trang {page} / {Math.ceil(data.total/12)}</span><button className="button secondary" disabled={page*12>=data.total} onClick={()=>{setBusy(true);setPage(page+1);}}>Trang sau</button></div></> : <div className="customer-empty"><Heart size={32}/><h2>Chưa có sản phẩm yêu thích</h2><p>Chọn biểu tượng trái tim trên sản phẩm bạn quan tâm.</p><Link href="/properties" className="button primary">Khám phá bất động sản</Link></div>}</main></>;
}
