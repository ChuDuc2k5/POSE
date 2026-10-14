'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { SiteHeader } from './site-header';
import type { Role } from '@/lib/roles';
import { CustomerNav } from './customer-nav';
import { PropertyCard, useFavoriteStatus } from './property-card';
import { PropertyFilterBar, filterNames, type PropertyFilters } from './property-filter-bar';
import { sortLabels, type SearchResult } from '@/lib/discovery';
import { CatalogRequestError, catalogRequest } from '@/lib/catalog-client';

export function PropertyBrowser({ initialQuery, role }: { initialQuery:string; role:Role|null }) {
  const router=useRouter();
  const [filters,setFilters]=useState<Record<string,string>>(()=>Object.fromEntries(filterNames.map(key=>[key,new URLSearchParams(initialQuery).get(key) || ''])));
  const [query,setQuery]=useState(initialQuery),[page,setPage]=useState(Number(new URLSearchParams(initialQuery).get('page')) || 1),[attempt,setAttempt]=useState(0);
  const [projects,setProjects]=useState<{id:string;name:string}[]>([]),[projectError,setProjectError]=useState(false);
  const [result,setResult]=useState<SearchResult|null>(null),[error,setError]=useState(''),[fields,setFields]=useState<Record<string,string>>({}),[busy,setBusy]=useState(true);
  const snapshot=useRef<string|null>(null);
  const favorites=useFavoriteStatus(result?.items.map(item=>item.id) || []);
  useEffect(()=>{const controller=new AbortController();catalogRequest<{items:typeof projects}>('/api/catalog/projects',{signal:controller.signal}).then(data=>setProjects(data.items)).catch(()=>{if(!controller.signal.aborted)setProjectError(true);});return()=>controller.abort();},[]);
  useEffect(()=>{
    const controller=new AbortController(),params=new URLSearchParams(query);params.set('page',String(page));params.set('pageSize','12');
    if(snapshot.current)params.set('snapshot',snapshot.current);else params.delete('snapshot');
    catalogRequest<SearchResult>(`/api/catalog/search?${params}`,{signal:controller.signal}).then(data=>{snapshot.current=data.snapshot;setResult(data);setError('');setFields({});}).catch(e=>{if(!controller.signal.aborted){setError(e instanceof Error ? e.message:'Chưa thể tìm kiếm.');if(e instanceof CatalogRequestError){setFields(e.fields);}setResult(null);}}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>controller.abort();
  },[query,page,attempt]);
  function search(value:PropertyFilters=filters){const params=new URLSearchParams();for(const key of filterNames)if(value[key])params.set(key,value[key]);snapshot.current=null;setFilters(value);setBusy(true);setPage(1);setQuery(params.toString());setAttempt(attempt+1);router.replace(`/properties${params.size ? `?${params}`:''}`,{scroll:false});}
  function changePage(value:number){setBusy(true);setPage(value);}
  return <><SiteHeader role={role}/><main className="discovery-main container"><CustomerNav active="discover"/><div className="discovery-heading"><span className="eyebrow">KHÁM PHÁ CÙNG TERAVA</span><h1>Tìm bất động sản phù hợp.</h1><p>Thông tin công bố rõ ràng, giúp bạn chọn sản phẩm theo nhu cầu.</p></div><PropertyFilterBar filters={filters} projects={projects} projectError={projectError} fields={fields} onApply={search}/><div className="discovery-layout"><section className="property-results" aria-busy={busy}><div className="property-results-top"><span>{busy ? 'Đang tìm kiếm…':`Bất động sản${filters.transaction==='Rent' ? ' cho thuê':filters.transaction==='Sale' ? ' mua bán':''} · ${result?.total ?? 0} kết quả`}</span><label>Sắp xếp<select name="sort" value={filters.sort || 'newest'} onChange={e=>search({...filters,sort:e.target.value})}>{Object.entries(sortLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>{favorites.error && <p role="alert" className="discovery-field-error">{favorites.error}</p>}{busy ? <div className="customer-empty" role="status">Đang tải kết quả tìm kiếm…</div> : error ? <div className="customer-empty" role="alert"><p>{error}</p>{fields.form && <p>{fields.form}</p>}<button className="button secondary" onClick={()=>search()}>Tìm lại</button></div> : result?.items.length ? <><div className="customer-product-grid discovery-product-grid">{result.items.map(item=><PropertyCard key={item.id} item={item} saved={favorites.has(item.id)} customer={favorites.customer} ready={favorites.ready && !favorites.error}/>)}</div><div className="discovery-pagination"><button className="button secondary" disabled={page<=1} onClick={()=>changePage(page-1)}>Trang trước</button><span>Trang {page} / {Math.max(1,Math.ceil(result.total/result.pageSize))}</span><button className="button secondary" disabled={page*result.pageSize>=result.total} onClick={()=>changePage(page+1)}>Trang sau</button></div></> : <div className="customer-empty"><Building2 size={32}/><h3>Không có sản phẩm phù hợp</h3><p>Thử thay đổi khu vực, khoảng giá hoặc loại bất động sản.</p></div>}</section></div></main></>;
}
