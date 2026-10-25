'use client';
import { useEffect, useId, useState } from 'react';
import Image from 'next/image';
import { Building2, FileDown, MapPin, Search, X } from 'lucide-react';
import { catalogRequest } from '@/lib/catalog-client';
import { availabilityLabels, priceLabel, propertyTypeLabels, publicationLabels } from '@/lib/catalog';
import type { Page, PropertyDetail, PropertyRef, SalesProperty } from '@/lib/sales';
import { Empty, Modal } from '../leads/ui';
import s from './sales.module.css';

export function PropertyPicker({ values, onChange, multiple = false }: { values: PropertyRef[]; onChange: (v: PropertyRef[]) => void; multiple?: boolean }) {
  const [q, setQ] = useState(''), [open, setOpen] = useState(false);
  const [items, setItems] = useState<SalesProperty[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const list = useId();
  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setError('');
      catalogRequest<Page<SalesProperty>>('/api/sales/properties?' + new URLSearchParams({ q, pageSize: '8' }), { signal: c.signal })
        .then(d => setItems(d.items)).catch(e => { if (!c.signal.aborted) setError(e.message); }).finally(() => { if (!c.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); c.abort(); };
  }, [q, open]);
  return <div className={s.picker}><div className={s.search}><Search size={16}/><input aria-label="Tìm BĐS đang phụ trách" value={q} maxLength={120} onFocus={() => setOpen(true)} onChange={e => { setQ(e.target.value); setItems([]); setOpen(true); }} placeholder="Tìm mã hoặc tên BĐS đang phụ trách…" aria-controls={list}/><button type="button" className={s.icon} onClick={() => setOpen(v => !v)} aria-expanded={open} aria-label={open ? 'Đóng lựa chọn BĐS' : 'Mở lựa chọn BĐS'}>{open ? <X size={16}/> : <Building2 size={16}/>}</button></div>
    <div className={s.chips}>{values.map(v => <span key={v.property_id}>{v.snapshot.code} · {v.snapshot.name}<button type="button" onClick={() => onChange(values.filter(x => x.property_id !== v.property_id))} aria-label={'Bỏ ' + v.snapshot.name}><X size={14}/></button></span>)}</div>
    {open && <div id={list} className={s.choices}>{loading ? <p>Đang tìm…</p> : error ? <p role="alert">{error}</p> : items.length ? items.map(p => <button type="button" key={p.id} disabled={values.some(v => v.property_id === p.id) || multiple && values.length >= 20} onClick={() => { const ref = { property_id: p.id, snapshot: { code: p.code, name: p.name, location: p.location, price: p.price } }; onChange(multiple ? [...values, ref] : [ref]); setOpen(false); setQ(''); }}><Building2 size={18}/><span><strong>{p.name}</strong><small>{p.code} · {p.location} · {priceLabel(p.price)}</small></span></button>) : <p>Chưa có BĐS đang phụ trách phù hợp với từ khóa.</p>}</div>}
  </div>;
}
export function PropertyCards({ items, onOpen }: { items: SalesProperty[]; onOpen: (id: string) => void }) {
  return items.length ? <div className={s.propertyGrid}>{items.map(p => <button className={s.propertyCard} key={p.id} onClick={() => onOpen(p.id)}><div className={s.cover}>{p.cover_id ? <Image unoptimized width={640} height={400} src={'/api/sales/media/' + p.cover_id} alt={p.name}/> : <Building2 size={44}/>}<span>{p.property_type && propertyTypeLabels[p.property_type]}</span></div><div className={s.propertyInfo}><small>{p.code} · {p.project_name}</small><h3>{p.name}</h3><p><MapPin size={14}/>{p.location}</p><strong>{priceLabel(p.price)}{p.price_period === 'Month' ? ' / tháng' : ''}</strong><div className={s.pills}><span>{p.availability && availabilityLabels[p.availability]}</span><span>{p.publication && publicationLabels[p.publication]}</span></div><small>Sales: {p.sales_name}</small></div></button>)}</div> : <Empty title="Chưa có BĐS trong danh mục">Các sản phẩm được phân công sẽ xuất hiện tại đây.</Empty>;
}
export function PropertyDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<PropertyDetail | null>(null), [error, setError] = useState('');
  useEffect(() => { const c = new AbortController(); catalogRequest<PropertyDetail>('/api/sales/properties/' + id, { signal: c.signal }).then(setData).catch(e => { if (!c.signal.aborted) setError(e.message); }); return () => c.abort(); }, [id]);
  const p = data?.item;
  return <Modal title={p?.name || 'Thông tin bất động sản'} subtitle="Danh mục được giao · Chỉ xem" onClose={onClose} wide><div className={s.modalBody}>{error ? <p className={s.error} role="alert">{error}</p> : !p ? <p role="status">Đang tải thông tin…</p> : <>
    <div className={s.pills}><span>{p.code}</span><span>{p.property_type && propertyTypeLabels[p.property_type]}</span><span>{p.publication && publicationLabels[p.publication]}</span><span>{p.availability && availabilityLabels[p.availability]}</span></div>
    <h3>{priceLabel(p.price)}{p.price_period === 'Month' ? ' / tháng' : ''}</h3><p><MapPin size={16}/> {p.location}</p><dl className={s.facts}><div><dt>Dự án / phân khu</dt><dd>{p.project_name}{p.subdivision_name && ' / ' + p.subdivision_name}</dd></div><div><dt>Giao dịch</dt><dd>{p.transaction_type === 'Rent' ? 'Cho thuê' : 'Mua bán'}</dd></div><div><dt>Diện tích</dt><dd>{p.area ?? '—'} m²</dd></div><div><dt>Phòng ngủ</dt><dd>{p.bedrooms ?? 'Chưa cập nhật'}</dd></div><div><dt>Sales phụ trách</dt><dd>{p.sales_name}</dd></div></dl><p className={s.pre}>{p.description || 'Chưa có mô tả.'}</p>
    <div className={s.gallery}>{data.media.filter(m => m.media_type === 'Image').map(m => <Image unoptimized width={640} height={400} key={m.id} src={'/api/sales/media/' + m.id} alt={m.name}/>)}</div>
    {data.media.filter(m => m.media_type === 'Document').map(m => <a className={s.fileLink} key={m.id} href={'/api/sales/media/' + m.id}><FileDown size={16}/>{m.name}</a>)}
  </>}</div></Modal>;
}
