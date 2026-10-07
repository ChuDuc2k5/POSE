'use client';
import Image from 'next/image';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Check, FileText, History, ImagePlus, LoaderCircle, LockKeyhole, Save, Upload, X, Building2, ExternalLink, Link2Off } from 'lucide-react';
import { availabilityLabels, publicationLabels, propertyTypeLabels, validateCatalog, type CatalogHistory, type CatalogItem, type CatalogKind, type PropertyMedia } from '@/lib/catalog';
import { CatalogRequestError, catalogRequest } from '@/lib/catalog-client';

type Kind = Exclude<CatalogKind,'media'>;
export type CatalogDetail = { item: CatalogItem; history: CatalogHistory[]; media: PropertyMedia[]; mediaTotal?: number };
const kindLabels = { projects: 'dự án', subdivisions: 'phân khu', properties: 'sản phẩm' };
function initialDraft(kind: Kind, item: CatalogItem | null, projectId: string) {
  const common: Record<string,unknown> = { code:item?.code || '', name:item?.name || '', location:item?.location || '', description:item?.description || '',version:item?.version || 0,reason:'' };
  if (kind !== 'properties') return { ...common, amenities:item?.amenities || '',archived:item?.archived || false,...(kind === 'subdivisions' ? {project_id:item?.project_id || projectId} : {}) };
  return { ...common, project_id:item?.project_id || projectId,subdivision_id:item?.subdivision_id || '',property_type:item?.property_type || 'Apartment',area:item?.area ?? '',bedrooms:item?.bedrooms ?? '',price:item?.price ?? '',publication:item?.publication || 'Draft',availability:item?.availability || 'Unavailable' };
}
function Field({id,label,error,children,hint}: {id:string;label:string;error?:string;children:ReactNode;hint?:string}) {
  return <div className="catalog-field"><label htmlFor={id}>{label}</label>{children}{error ? <small className="catalog-field-error" id={`${id}-error`}>{error}</small> : hint && <small>{hint}</small>}</div>;
}
const historyLabels: Record<string,string> = { projects_created:'Tạo dự án',projects_updated:'Cập nhật dự án',subdivisions_created:'Tạo phân khu',subdivisions_updated:'Cập nhật phân khu',properties_created:'Tạo sản phẩm',properties_updated:'Cập nhật sản phẩm',media_created:'Thêm tệp sản phẩm',media_updated:'Cập nhật liên kết tệp' };

export function CatalogEditor({kind,detail,projects,subdivisions,onClose,onSaved}: {kind:Kind;detail:CatalogDetail | null;projects:CatalogItem[];subdivisions:CatalogItem[];onClose:()=>void;onSaved:()=>void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [record,setRecord] = useState<CatalogItem | null>(detail?.item || null);
  const [draft,setDraft] = useState<Record<string,unknown>>(() => initialDraft(kind,detail?.item || null,projects.find(p=>!p.archived)?.id || ''));
  const [media,setMedia] = useState(detail?.media || []);
  const [mediaTotal,setMediaTotal] = useState(detail?.mediaTotal || detail?.media.length || 0);
  const [history,setHistory] = useState(detail?.history || []);
  const [tab,setTab] = useState<'info'|'media'|'history'>('info');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [fields,setFields] = useState<Record<string,string>>({});
  useEffect(() => { const element=dialog.current; element?.showModal(); return () => element?.close(); },[]);
  const field = (key:string,value:unknown) => { setDraft(prev=>({...prev,[key]:value,...(key==='project_id' && kind==='properties' ? {subdivision_id:''} : {})})); setFields(prev=>({...prev,[key]:''})); };
  const props = (key:string) => ({id:`catalog-${key}`,'aria-invalid':!!fields[key],'aria-describedby':fields[key] ? `catalog-${key}-error` : undefined,disabled:busy});
  const fail = (cause:unknown) => { setError(cause instanceof Error ? cause.message : 'Không thể kết nối. Vui lòng thử lại.'); if (cause instanceof CatalogRequestError) setFields(cause.fields); };
  const reload = async (id:string) => {
    const data = await catalogRequest<CatalogDetail>(`/api/admin/catalog/${kind}/${id}`);
    setRecord(data.item); setMedia(data.media); setMediaTotal(data.mediaTotal || data.media.length); setHistory(data.history);
    // Uploading or editing media advances the product version, preserving form edits.
    setDraft(prev=>({...prev,version:data.item.version}));
    return data.item;
  };
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    const input = {...draft};
    if (kind==='properties') { input.area=Number(draft.area); input.bedrooms=draft.bedrooms==='' ? null : Number(draft.bedrooms); input.price=draft.price==='' ? null : Number(draft.price); input.subdivision_id=draft.subdivision_id || null; }
    const errors=validateCatalog(kind,input);
    const reasonNeeded = kind === 'properties' ? ((['Hidden','Archived'].includes(String(draft.publication)) && draft.publication!==record?.publication) || (!!record && draft.availability!==record.availability)) : (!!draft.archived && !record?.archived);
    if (reasonNeeded && String(draft.reason).trim().length < 3) errors.reason='Nhập lý do thay đổi (ít nhất 3 ký tự).';
    if (Object.keys(errors).length) { setFields(errors); setError('Kiểm tra các trường được đánh dấu trước khi lưu.'); return; }
    setBusy(true); setFields({});
    try {
      const data=await catalogRequest<{item:CatalogItem;message:string}>(`/api/admin/catalog/${kind}${record ? `/${record.id}` : ''}`,{method:record ? 'PATCH' : 'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
      setRecord(data.item); setDraft(initialDraft(kind,data.item,String(data.item.project_id || ''))); setNotice(data.message); onSaved();
      try { await reload(data.item.id); } catch { setError('Đã lưu dữ liệu, nhưng chưa tải được lịch sử mới. Hãy tải lại chi tiết.'); }
    } catch(cause) { fail(cause); } finally { setBusy(false); }
  }
  async function upload(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!record) return;
    const element=event.currentTarget, form=new FormData(element), file=form.get('file');
    if (!(file instanceof File) || !file.size) { setError('Chọn tệp cần tải lên.'); return; }
    const pdf=file.type==='application/pdf';
    if ((!pdf && !['image/jpeg','image/png','image/webp'].includes(file.type)) || file.size>(pdf ? 20 : 10)*1024*1024) { setError('Ảnh tối đa 10 MB, PDF tối đa 20 MB. Chỉ nhận JPG, PNG, WebP và PDF.'); return; }
    form.set('name',String(form.get('name') || file.name).trim().slice(0,160)); form.set('version',String(draft.version));
    setBusy(true); setError(''); setNotice('');
    try { const data=await catalogRequest<{message:string}>(`/api/admin/catalog/properties/${record.id}/media`,{method:'POST',body:form}); element.reset(); await reload(record.id); onSaved(); setNotice(data.message); }
    catch(cause) { fail(cause); } finally { setBusy(false); }
  }
  async function saveMedia(item:PropertyMedia,input:Record<string,unknown>) {
    if (!record) return;
    setBusy(true); setError(''); setNotice('');
    try { const data=await catalogRequest<{message:string}>(`/api/admin/catalog/media/${item.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,version:item.version,reason:input.removed ? 'Gỡ liên kết tệp sản phẩm' : 'Cập nhật hiển thị tệp sản phẩm'})}); await reload(record.id); onSaved(); setNotice(data.message); }
    catch(cause) { fail(cause); } finally { setBusy(false); }
  }
  async function moreMedia() {
    if (!record) return;
    setBusy(true); setError('');
    try { const data=await catalogRequest<CatalogDetail>(`/api/admin/catalog/${kind}/${record.id}?mediaPage=${Math.floor(media.length/50)+1}`); setMedia(prev=>[...prev,...data.media]); }
    catch(cause) { fail(cause); } finally { setBusy(false); }
  }
  const tabs: {id:typeof tab;label:string;icon:typeof Building2}[] = [{id:'info',label:'Thông tin',icon:Building2},...(kind==='properties' ? [{id:'media' as const,label:'Hình ảnh & tài liệu',icon:ImagePlus}] : []),{id:'history',label:'Lịch sử',icon:History}];
  return <dialog className="catalog-editor" ref={dialog} aria-labelledby="catalog-editor-title" onCancel={event=>{event.preventDefault(); if (!busy) onClose();}}>
    <div className="catalog-editor-header"><span className="catalog-editor-symbol"><Building2 size={23}/></span><div><span className="eyebrow">QUẢN LÝ BẤT ĐỘNG SẢN</span><h2 id="catalog-editor-title">{record ? `Chi tiết ${kindLabels[kind]}` : `Thêm ${kindLabels[kind]} mới`}</h2></div><button type="button" className="catalog-icon-button" aria-label="Đóng chi tiết" onClick={onClose} disabled={busy}><X size={21}/></button></div>
    <div className="catalog-editor-tabs" role="tablist" aria-label="Chi tiết danh mục">{tabs.map(({id,label,icon:Icon},index)=><button id={`catalog-tab-${id}`} aria-controls={`catalog-panel-${id}`} key={id} type="button" role="tab" tabIndex={tab===id ? 0:-1} aria-selected={tab===id} onClick={()=>setTab(id)} onKeyDown={event=>{
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const next=event.key==='Home' ? 0:event.key==='End' ? tabs.length-1:(index+(event.key==='ArrowRight' ? 1:-1)+tabs.length)%tabs.length;
      setTab(tabs[next].id); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#catalog-tab-${tabs[next].id}`)?.focus();
    }}><Icon size={16}/>{label}</button>)}</div>
    <div className="catalog-editor-body"><div aria-live="polite">{error && <div className="form-alert error" role="alert">{error}{error.includes('Tải lại') && record && <button type="button" onClick={()=>void reload(record.id).then(latest=>{setDraft(initialDraft(kind,latest,latest.project_id || ''));setFields({});setError('');}).catch(fail)} disabled={busy}>Tải lại chi tiết</button>}</div>}{notice && <div className="form-alert success" role="status"><Check size={17}/>{notice}</div>}</div>
      {tab==='info' && <div role="tabpanel" id="catalog-panel-info" aria-labelledby="catalog-tab-info"><form id="catalog-edit-form" onSubmit={save}>
        <fieldset disabled={busy}><div className="catalog-form-section"><h3>Thông tin cơ bản</h3><p>Điền thông tin nhận diện và vị trí của {kindLabels[kind]}.</p><div className="catalog-form-grid">
          <Field id="catalog-code" label="Mã định danh *" error={fields.code} hint="Mã duy nhất, gồm 2–40 ký tự."><input {...props('code')} value={String(draft.code)} onChange={e=>field('code',e.target.value.toUpperCase())} placeholder={kind==='projects' ? 'VD: PRJ-001' : kind==='subdivisions' ? 'VD: ZONE-A' : 'VD: A-1201'} required minLength={2} maxLength={40}/></Field>
          <Field id="catalog-name" label={`${kind==='properties' ? 'Tên sản phẩm' : kind==='projects' ? 'Tên dự án' : 'Tên phân khu'} *`} error={fields.name}><input {...props('name')} value={String(draft.name)} onChange={e=>field('name',e.target.value)} placeholder="Nhập tên hiển thị" required minLength={2} maxLength={160}/></Field>
          {kind!=='projects' && <Field id="catalog-project_id" label="Dự án *" error={fields.project_id}><select {...props('project_id')} value={String(draft.project_id)} onChange={e=>field('project_id',e.target.value)} required><option value="">Chọn dự án</option>{projects.map(p=><option key={p.id} value={p.id} disabled={p.archived}>{p.name}{p.archived ? ' (Lưu trữ)' : ''}</option>)}</select></Field>}
          {kind==='properties' && <Field id="catalog-subdivision_id" label="Phân khu" error={fields.subdivision_id}><select {...props('subdivision_id')} value={String(draft.subdivision_id)} onChange={e=>field('subdivision_id',e.target.value)}><option value="">Không thuộc phân khu</option>{subdivisions.filter(s=>s.project_id===draft.project_id).map(s=><option key={s.id} value={s.id} disabled={s.archived}>{s.name}{s.archived ? ' (Lưu trữ)' : ''}</option>)}</select></Field>}
          <div className="catalog-field-wide"><Field id="catalog-location" label="Vị trí / địa chỉ *" error={fields.location}><input {...props('location')} value={String(draft.location)} onChange={e=>field('location',e.target.value)} placeholder="Địa chỉ, khu vực, tỉnh / thành phố" required minLength={2} maxLength={300}/></Field></div>
        </div></div>
        {kind==='properties' && <div className="catalog-form-section"><h3>Thông số & giá</h3><p>Giá được tính bằng VND. Để trống giá để hiển thị “Liên hệ”.</p><div className="catalog-form-grid">
          <Field id="catalog-property_type" label="Loại bất động sản *" error={fields.property_type}><select {...props('property_type')} value={String(draft.property_type)} onChange={e=>field('property_type',e.target.value)}>{Object.entries(propertyTypeLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field>
          <Field id="catalog-area" label="Diện tích (m²) *" error={fields.area}><input {...props('area')} type="number" min="0.01" max="1000000000" step="0.01" value={String(draft.area)} onChange={e=>field('area',e.target.value)} placeholder="VD: 85" required/></Field>
          <Field id="catalog-bedrooms" label="Số phòng ngủ" error={fields.bedrooms}><input {...props('bedrooms')} type="number" min="0" max="100" step="1" value={String(draft.bedrooms)} onChange={e=>field('bedrooms',e.target.value)} placeholder="Để trống nếu không áp dụng"/></Field>
          <Field id="catalog-price" label="Giá công bố (VND)" error={fields.price}><input {...props('price')} type="number" min="0.01" max="1000000000000000" step="0.01" value={String(draft.price)} onChange={e=>field('price',e.target.value)} placeholder="Để trống: Liên hệ"/></Field>
        </div></div>}
        <div className="catalog-form-section"><h3>Nội dung giới thiệu</h3><div className="catalog-form-grid"><div className="catalog-field-wide"><Field id="catalog-description" label="Mô tả" error={fields.description} hint={kind==='properties' ? 'Cần ít nhất 20 ký tự để công bố sản phẩm.' : undefined}><textarea {...props('description')} rows={4} value={String(draft.description)} onChange={e=>field('description',e.target.value)} maxLength={10000} placeholder="Đặc điểm nổi bật và thông tin chi tiết…"/></Field></div>{kind!=='properties' && <div className="catalog-field-wide"><Field id="catalog-amenities" label="Tiện ích" error={fields.amenities}><textarea {...props('amenities')} rows={2} value={String(draft.amenities)} onChange={e=>field('amenities',e.target.value)} maxLength={3000} placeholder="Hồ bơi, công viên, khu vui chơi…"/></Field></div>}</div></div>
        <div className="catalog-form-section"><h3>Trạng thái & hiển thị</h3><div className="catalog-form-grid">{kind==='properties' ? <>
          <Field id="catalog-publication" label="Trạng thái công bố" error={fields.publication}><select {...props('publication')} value={String(draft.publication)} onChange={e=>field('publication',e.target.value)}>{Object.entries(publicationLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field>
          <Field id="catalog-availability" label="Tình trạng mở bán" error={fields.availability}><select {...props('availability')} value={String(draft.availability)} onChange={e=>field('availability',e.target.value)}>{Object.entries(availabilityLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field>
          <p className="catalog-field-wide catalog-form-note"><LockKeyhole size={15}/> Chỉ sản phẩm đã công bố, thuộc dự án/phân khu còn hiệu lực, được hiển thị công khai. Giữ chỗ / Đã bán là thông tin quản lý.</p>
        </> : <label className="catalog-archive-choice catalog-field-wide"><input type="checkbox" checked={!!draft.archived} onChange={e=>field('archived',e.target.checked)} disabled={busy}/><span><strong>Lưu trữ {kindLabels[kind]}</strong><small>Sản phẩm thuộc mục đã lưu trữ sẽ ngừng hiển thị công khai. Lịch sử vẫn được giữ lại.</small></span></label>}
          <div className="catalog-field-wide"><Field id="catalog-reason" label="Lý do thay đổi" error={fields.reason} hint="Bắt buộc khi ẩn, lưu trữ hoặc đổi tình trạng mở bán."><textarea {...props('reason')} rows={2} value={String(draft.reason)} onChange={e=>field('reason',e.target.value)} maxLength={1000} placeholder="Ghi rõ lý do để theo dõi trong lịch sử…"/></Field></div>
        </div></div></fieldset>
      </form></div>}
      {tab==='media' && <div role="tabpanel" id="catalog-panel-media" aria-labelledby="catalog-tab-media">{!record ? <div className="catalog-tab-empty"><ImagePlus size={35}/><h3>Lưu sản phẩm trước khi thêm tệp</h3><p>Hình ảnh và tài liệu sẽ được liên kết với sản phẩm đã tạo.</p><button className="button secondary" onClick={()=>setTab('info')}>Về thông tin sản phẩm</button></div> : <>
        <form className="catalog-upload-form" onSubmit={upload}><div className="catalog-upload-heading"><Upload size={22}/><div><h3>Thêm hình ảnh hoặc tài liệu</h3><p>JPG, PNG, WebP ≤ 10 MB · PDF ≤ 20 MB</p></div></div><fieldset disabled={busy}><label className="catalog-file-picker">Chọn tệp<input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" required/></label><div className="catalog-form-grid"><Field id="upload-name" label="Tên hiển thị"><input id="upload-name" name="name" maxLength={160} placeholder="Để trống để dùng tên tệp"/></Field><Field id="upload-visibility" label="Quyền hiển thị"><select id="upload-visibility" name="visibility" defaultValue="Internal"><option value="Internal">Nội bộ</option><option value="Public">Công khai</option></select></Field><Field id="upload-sort" label="Thứ tự hiển thị"><input id="upload-sort" name="sort_order" type="number" min={0} max={10000} defaultValue={0} required/></Field><button className="button primary catalog-upload-button" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin"/> : <Upload size={17}/>} Tải tệp lên</button></div></fieldset></form>
        <div className="catalog-media-heading"><h3>Tệp sản phẩm <span>{mediaTotal}</span></h3><p>Tài liệu nội bộ chỉ quản trị viên được truy cập.</p></div>
        {media.length ? <div className="catalog-media-grid">{media.map(item=><MediaCard key={`${item.id}:${item.version}`} item={item} busy={busy} onSave={input=>void saveMedia(item,input)}/>)}</div> : <div className="catalog-tab-empty compact"><ImagePlus size={30}/><p>Sản phẩm chưa có hình ảnh hoặc tài liệu.</p></div>}
        {media.length<mediaTotal && <button className="button secondary" disabled={busy} onClick={()=>void moreMedia()}>Xem thêm tệp</button>}
      </>}</div>}
      {tab==='history' && <div role="tabpanel" id="catalog-panel-history" aria-labelledby="catalog-tab-history"><div className="catalog-history-heading"><h3>Lịch sử thay đổi</h3><p>20 hoạt động gần nhất · Thời gian Việt Nam (UTC+7)</p></div>{history.length ? <ol className="catalog-history-list">{history.map(entry=><li key={entry.id}><span><History size={17}/></span><div><h4>{historyLabels[entry.action] || 'Cập nhật dữ liệu'}</h4><p>{new Date(entry.created_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})} · <span title={entry.actor_id}>Admin ({entry.actor_id.slice(0,8)})</span></p>{entry.reason && <blockquote>{entry.reason}</blockquote>}<div className="catalog-history-changes">{entry.after_data.publication && entry.after_data.publication!==entry.before_data?.publication ? <span>Công bố: {publicationLabels[entry.after_data.publication as keyof typeof publicationLabels]}</span> : null}{entry.after_data.availability && entry.after_data.availability!==entry.before_data?.availability ? <span>Mở bán: {availabilityLabels[entry.after_data.availability as keyof typeof availabilityLabels]}</span> : null}{entry.after_data.version !== undefined && <span>Phiên bản {String(entry.after_data.version)}</span>}</div></div></li>)}</ol> : <div className="catalog-tab-empty"><History size={32}/><p>Chưa có lịch sử. Các thay đổi sẽ xuất hiện sau khi lưu.</p></div>}</div>}
    </div>
    <footer className="catalog-editor-footer"><span><LockKeyhole size={14}/>{record ? `Phiên bản ${draft.version}` : 'Dữ liệu mới'} · Lưu cùng lịch sử thay đổi</span><div><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Đóng</button>{tab==='info' && <button type="submit" form="catalog-edit-form" className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17}/> : <Save size={17}/>} {record ? 'Lưu thay đổi' : `Tạo ${kindLabels[kind]}`}<ArrowRight size={15}/></button>}</div></footer>
  </dialog>;
}

function MediaCard({item,busy,onSave}: {item:PropertyMedia;busy:boolean;onSave:(input:Record<string,unknown>)=>void}) {
  const [name,setName]=useState(item.name), [order,setOrder]=useState(item.sort_order), [visibility,setVisibility]=useState(item.visibility), [visible,setVisible]=useState(item.visible);
  const input = {name,sort_order:order,visibility,visible,removed:false};
  return <article className="catalog-media-card"><div className="catalog-media-preview">{item.media_type==='Image' ? <Image src={`/api/catalog/media/${item.id}`} width={300} height={170} unoptimized alt={item.name}/> : <div><FileText size={36}/><span>PDF DOCUMENT</span></div>}<span className="catalog-media-size">{(item.size_bytes/1024/1024).toFixed(2)} MB</span><a href={`/api/catalog/media/${item.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Mở tệp ${item.name}`}><ExternalLink size={16}/></a></div><form onSubmit={e=>{e.preventDefault();onSave(input);}}><fieldset disabled={busy}><Field id={`media-name-${item.id}`} label="Tên tệp"><input id={`media-name-${item.id}`} value={name} onChange={e=>setName(e.target.value)} required maxLength={160}/></Field><div className="catalog-form-grid"><Field id={`media-visibility-${item.id}`} label="Quyền hiển thị"><select id={`media-visibility-${item.id}`} value={visibility} onChange={e=>setVisibility(e.target.value as PropertyMedia['visibility'])}><option value="Internal">Nội bộ</option><option value="Public">Công khai</option></select></Field><Field id={`media-order-${item.id}`} label="Thứ tự"><input id={`media-order-${item.id}`} type="number" min={0} max={10000} value={order} onChange={e=>setOrder(Number(e.target.value))} required/></Field></div><label className="catalog-media-visible"><input type="checkbox" checked={visible} onChange={e=>setVisible(e.target.checked)}/> Hiển thị tệp trong danh sách</label><div className="catalog-media-actions"><button type="button" onClick={()=>{if(window.confirm('Gỡ liên kết tệp này khỏi sản phẩm? Tệp và lịch sử vẫn được lưu để đối soát.'))onSave({...input,removed:true,visible:false});}}><Link2Off size={14}/> Gỡ liên kết</button><button type="submit"><Check size={14}/> Lưu tệp</button></div></fieldset></form></article>;
}
