'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Building2, ChevronLeft, ChevronRight, FolderKanban, Layers3, LoaderCircle, MapPin, Plus, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, UserRound, Pencil, LayoutGrid, Check } from 'lucide-react';
import { Brand } from './brand';
import { LogoutButton } from './logout-button';
import { CatalogEditor, type CatalogDetail } from './catalog-editor';
import { catalogRequest } from '@/lib/catalog-client';
import { availabilityLabels, priceLabel, publicationLabels, propertyTypeLabels, type CatalogItem } from '@/lib/catalog';

type Kind = 'projects'|'subdivisions'|'properties';
type List = {items:CatalogItem[];total:number;page:number;pageSize:number};
const sections = [{kind:'properties',name:'Sản phẩm',icon:Building2},{kind:'projects',name:'Dự án',icon:FolderKanban},{kind:'subdivisions',name:'Phân khu',icon:Layers3}] as const;
const names: Record<Kind,string> = {projects:'dự án',subdivisions:'phân khu',properties:'sản phẩm'};
async function options(kind:Kind,signal:AbortSignal) {
  const items:CatalogItem[]=[]; let page=1;
  while (true) {
    const data=await catalogRequest<List>(`/api/admin/catalog/${kind}?page=${page}&pageSize=50`,{signal});
    items.push(...data.items);
    if (items.length>=data.total || !data.items.length) return items;
    if (++page>200) throw new Error('Danh mục vượt quá giới hạn tải. Vui lòng liên hệ quản trị hệ thống.');
  }
}
export function CatalogWorkspace({name}: {name:string}) {
  const [kind,setKind]=useState<Kind>('properties');
  const [items,setItems]=useState<CatalogItem[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(1);
  const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[status,setStatus]=useState(''),[project,setProject]=useState('');
  const [projects,setProjects]=useState<CatalogItem[]>([]),[subdivisions,setSubdivisions]=useState<CatalogItem[]>([]);
  const [stats,setStats]=useState({properties:0,published:0});
  const [optionsError,setOptionsError]=useState('');
  const [loadedKey,setLoadedKey]=useState(''),[error,setError]=useState(''),[revision,setRevision]=useState(0),[opening,setOpening]=useState('');
  const [editor,setEditor]=useState<{kind:Kind;detail:CatalogDetail|null}|null>(null);
  const loadKey=JSON.stringify([kind,page,query,status,project,revision]);
  const loading=loadedKey!==loadKey;
  useEffect(()=>{const timer=setTimeout(()=>{setQuery(search.trim());setPage(1);},300);return()=>clearTimeout(timer);},[search]);
  useEffect(()=>{
    const controller=new AbortController();
    Promise.all([options('projects',controller.signal),options('subdivisions',controller.signal),catalogRequest<List>('/api/admin/catalog/properties?pageSize=1',{signal:controller.signal}),catalogRequest<List>('/api/admin/catalog/properties?status=Published&pageSize=1',{signal:controller.signal})])
      .then(([p,s,all,published])=>{setProjects(p);setSubdivisions(s);setStats({properties:all.total,published:published.total});setOptionsError('');})
      .catch(cause=>{if(cause.name!=='AbortError')setOptionsError(cause.message || 'Không thể tải danh mục dự án.');});
    return()=>controller.abort();
  },[revision]);
  useEffect(()=>{
    const controller=new AbortController();
    const params=new URLSearchParams({page:String(page),pageSize:'20',search:query,...(status ? {status}:{}),...(project && kind!=='projects' ? {project}:{})});
    catalogRequest<List>(`/api/admin/catalog/${kind}?${params}`,{signal:controller.signal}).then(data=>{setItems(data.items);setTotal(data.total);setError('');})
      .catch(cause=>{if(cause.name!=='AbortError')setError(cause.message || 'Không thể tải dữ liệu.');})
      .finally(()=>{if(!controller.signal.aborted)setLoadedKey(loadKey);});
    return()=>controller.abort();
  },[kind,page,query,status,project,revision,loadKey]);
  function changeKind(value:Kind) {setKind(value);setStatus('');setProject('');setPage(1);setSearch('');setQuery('');}
  async function edit(item:CatalogItem) {
    setOpening(item.id);setError('');
    try {const detail=await catalogRequest<CatalogDetail>(`/api/admin/catalog/${kind}/${item.id}`);setEditor({kind,detail});}
    catch(cause){setError(cause instanceof Error ? cause.message : 'Không thể tải chi tiết.');}finally{setOpening('');}
  }
  const projectNames=new Map(projects.map(p=>[p.id,p.name]));
  const subdivisionNames=new Map(subdivisions.map(s=>[s.id,s.name]));
  const pages=Math.max(1,Math.ceil(total/20));
  return <main className="catalog-workspace">
    <aside className="catalog-sidebar"><Brand light href="/admin"/><div className="catalog-sidebar-label">KHÔNG GIAN QUẢN TRỊ</div><nav aria-label="Quản trị bất động sản">{sections.map(({kind:value,name:label,icon:Icon})=><button key={value} className={kind===value ? 'active':''} onClick={()=>changeKind(value)} aria-current={kind===value ? 'page':undefined}><Icon size={19}/>{label}<ChevronRight size={15}/></button>)}</nav><div className="catalog-sidebar-note"><ShieldCheck size={22}/><h3>Dữ liệu luôn có lịch sử.</h3><p>Mọi thay đổi được lưu cùng người thực hiện và phiên bản.</p></div><div className="catalog-sidebar-bottom"><Link href="/account"><UserRound size={17}/> Hồ sơ cá nhân <ArrowRight size={14}/></Link><Link href="/admin"><LayoutGrid size={17}/> Trang chủ <ArrowRight size={14}/></Link><LogoutButton/></div></aside>
    <div className="catalog-workspace-main"><header className="catalog-topbar"><div><span>Quản trị</span><ChevronRight size={13}/><strong>Bất động sản</strong></div><Link href="/account" className="catalog-admin-user"><span>{name.slice(0,1).toUpperCase()}</span><div><strong>{name}</strong><small>Quản trị viên</small></div><Settings2 size={17}/></Link></header>
      <div className="catalog-content"><div className="catalog-title"><div><span className="eyebrow">DANH MỤC BẤT ĐỘNG SẢN</span><h1>Quản lý bất động sản</h1><p>Tổ chức danh mục, quản lý sản phẩm và chủ động công bố thông tin.</p></div><button className="button primary" onClick={()=>setEditor({kind,detail:null})}><Plus size={18}/> Thêm {names[kind]}</button></div>
        <div className="catalog-stats">{[{label:'Tổng dự án',value:projects.length,icon:FolderKanban,detail:'Cấu trúc danh mục'},{label:'Tổng phân khu',value:subdivisions.length,icon:Layers3,detail:'Thuộc các dự án'},{label:'Tổng sản phẩm',value:stats.properties,icon:Building2,detail:'Tất cả trạng thái'},{label:'Đã công bố',value:stats.published,icon:Check,detail:'Trạng thái Published'}].map(({label,value,icon:Icon,detail})=><article key={label}><div><span>{label}</span><span className="catalog-stat-icon"><Icon size={19}/></span></div><strong>{value.toLocaleString('vi-VN')}</strong><small>{detail}</small></article>)}</div>
        <section className="catalog-list-panel" aria-labelledby="catalog-list-title"><div className="catalog-list-heading"><div><h2 id="catalog-list-title">Danh sách {names[kind]}<span>{loading ? '…':total}</span></h2><p>{kind==='properties' ? 'Quản lý nội dung, tệp đính kèm và trạng thái sản phẩm.' : kind==='projects' ? 'Quản lý dự án, vị trí và tiện ích.' : 'Tổ chức phân khu trong từng dự án.'}</p></div><button className="catalog-refresh" onClick={()=>setRevision(r=>r+1)} disabled={loading} aria-label="Tải lại danh mục"><RefreshCw size={16} className={loading ? 'spin':''}/><span>Tải lại</span></button></div>
          <div className="catalog-section-tabs" aria-label="Chọn danh mục">{sections.map(({kind:value,name:label,icon:Icon})=><button key={value} onClick={()=>changeKind(value)} aria-pressed={kind===value}><Icon size={16}/>{label}</button>)}</div>
          <div className="catalog-toolbar"><label className="catalog-search"><Search size={18}/><span className="profile-sr-only">Tìm theo mã hoặc tên</span><input value={search} onChange={e=>setSearch(e.target.value)} maxLength={160} placeholder={`Tìm mã hoặc tên ${names[kind]}…`}/></label><div className="catalog-filter"><SlidersHorizontal size={16}/><label><span className="profile-sr-only">Lọc trạng thái</span><select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">Tất cả trạng thái</option>{kind==='properties' ? Object.entries(publicationLabels).map(([key,label])=><option key={key} value={key}>{label}</option>) : <><option value="active">Còn hiệu lực</option><option value="archived">Lưu trữ</option></>}</select></label></div>{kind!=='projects' && <label className="catalog-project-filter"><span className="profile-sr-only">Lọc dự án</span><select value={project} onChange={e=>{setProject(e.target.value);setPage(1);}}><option value="">Tất cả dự án</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}</div>
          {(error || optionsError) && <div className="catalog-list-error form-alert error" role="alert">{error || optionsError}<button onClick={()=>setRevision(r=>r+1)}>Thử lại</button></div>}
          {loading ? <div className="catalog-list-loading"><LoaderCircle size={25} className="spin"/><p>Đang tải danh mục…</p></div> : error ? null : items.length ? <div className="catalog-table-scroll"><table><thead><tr><th>{kind==='properties' ? 'Sản phẩm' : kind==='projects' ? 'Dự án' : 'Phân khu'}</th>{kind==='properties' ? <><th>Dự án / Phân khu</th><th>Thông số & giá</th><th>Công bố</th><th>Mở bán</th></> : <><th>{kind==='projects' ? 'Vị trí':'Dự án'}</th><th>Trạng thái</th></>}<th>Cập nhật</th><th><span className="profile-sr-only">Thao tác</span></th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td><div className="catalog-item-name"><span><Building2 size={21}/></span><div><strong>{item.name}</strong><small>{item.code}{kind==='properties' && item.property_type ? ` · ${propertyTypeLabels[item.property_type]}`:''}</small></div></div></td>{kind==='properties' ? <><td><div className="catalog-parent-name">{projectNames.get(item.project_id || '') || 'Đang tải dự án'}<small>{subdivisionNames.get(item.subdivision_id || '') || 'Không thuộc phân khu'}</small></div></td><td><div className="catalog-property-numbers"><strong>{priceLabel(item.price)}</strong><small>{item.area} m²{item.bedrooms != null ? ` · ${item.bedrooms} PN`:''}</small></div></td><td><span className={`catalog-badge publication-${item.publication}`}>{publicationLabels[item.publication!]}</span></td><td><span className={`catalog-badge availability-${item.availability}`}>{availabilityLabels[item.availability!]}</span></td></> : <><td>{kind==='projects' ? <span className="catalog-location"><MapPin size={14}/>{item.location}</span> : <div className="catalog-parent-name">{projectNames.get(item.project_id || '') || 'Đang tải dự án'}<small>{item.location}</small></div>}</td><td><span className={`catalog-badge ${item.archived ? 'publication-Archived':'publication-Published'}`}>{item.archived ? 'Lưu trữ':'Còn hiệu lực'}</span></td></>}<td><time className="catalog-updated" dateTime={item.updated_at}>{new Date(item.updated_at).toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}<small>Phiên bản {item.version}</small></time></td><td><button className="catalog-edit-button" onClick={()=>void edit(item)} disabled={!!opening} aria-label={`Chỉnh sửa ${item.name}`}>{opening===item.id ? <LoaderCircle size={16} className="spin"/> : <Pencil size={16}/>}</button></td></tr>)}</tbody></table></div> : <div className="catalog-empty"><span><Building2 size={32}/></span><h3>{query || status || project ? 'Không tìm thấy kết quả' : `Chưa có ${names[kind]}`}</h3><p>{query || status || project ? 'Thử thay đổi từ khóa hoặc bộ lọc để tìm dữ liệu phù hợp.' : `Bắt đầu bằng cách thêm ${names[kind]} đầu tiên vào danh mục.`}</p><button className="button secondary" onClick={()=>{if(query || status || project){setSearch('');setQuery('');setStatus('');setProject('');setPage(1);}else setEditor({kind,detail:null});}}>{query || status || project ? 'Xóa bộ lọc':`Thêm ${names[kind]} mới`}<ArrowRight size={16}/></button></div>}
          <footer className="catalog-list-footer"><span>{total ? `${(page-1)*20+1}–${Math.min(page*20,total)} trong ${total} ${names[kind]}` : '0 kết quả'}<small>20 mục / trang</small></span><div><button onClick={()=>setPage(p=>p-1)} disabled={page<=1 || loading} aria-label="Trang trước"><ChevronLeft size={17}/></button><span>Trang {page} / {pages}</span><button onClick={()=>setPage(p=>p+1)} disabled={page>=pages || loading} aria-label="Trang sau"><ChevronRight size={17}/></button></div></footer>
        </section><div className="catalog-bottom-note"><ShieldCheck size={15}/><span>Quyền quản trị được kiểm tra ở mỗi thao tác. Dữ liệu lưu trữ vẫn giữ nguyên lịch sử.</span></div>
      </div>
    </div>
    {editor && <CatalogEditor kind={editor.kind} detail={editor.detail} projects={projects} subdivisions={subdivisions} onClose={()=>setEditor(null)} onSaved={()=>setRevision(r=>r+1)}/>}
  </main>;
}
