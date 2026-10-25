'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Building2, ChevronLeft, ChevronRight, Pencil, Search, UserCheck } from 'lucide-react';
import { catalogRequest, CatalogRequestError } from '@/lib/catalog-client';
import { useCrmQuery, useCrmState } from '../crm/crm-workspace';
import { availabilityLabels, publicationLabels, propertyTypeLabels } from '@/lib/catalog';
import type { OwnerList, OwnerProperty, SalesOption } from '@/lib/leads';
import { Empty, Modal } from './ui';
import s from './leads.module.css';

export function PropertyOwners({ sales, revision, onSaved }: { sales: SalesOption[]; revision: number; onSaved: () => void }) {
  const [search, setSearch] = useCrmState('leads.owners.search', ''), [query, setQuery] = useCrmState('leads.owners.query', ''), [page, setPage] = useCrmState('leads.owners.page', 1);
  const [editing, setEditing] = useState<OwnerProperty | null>(null);
  const result = useCrmQuery<OwnerList>('/api/leads/property-owners?' + new URLSearchParams({ q: query, page: String(page), pageSize: '15' }), revision);
  const { data, error } = result, loading = result.loading || result.updating;
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search, query, setQuery, setPage]);
  return <section className={s.panel}><div className={s.panelHeader}><div><span className={s.eyebrow}>ĐỘI NGŨ & DANH MỤC</span><h2>Sales phụ trách bất động sản <span className={s.count}>{data?.total ?? '—'}</span></h2><p>Mỗi sản phẩm có một Sales chính. Phân công được dùng để kết nối Lead phù hợp.</p></div><span className={s.softIcon}><UserCheck size={23}/></span></div>
    <div className={s.toolbar}><label className={s.searchInput}><Search size={18}/><input aria-label="Tìm BĐS để phân công" value={search} onChange={e => setSearch(e.target.value)} maxLength={120} placeholder="Tìm theo mã, tên hoặc khu vực…"/></label></div>
    {error && <div className={s.error} role="alert">{error}<button className={s.textButton} onClick={onSaved}>Thử lại</button></div>}
    {loading && !data ? <div className={s.loading}>Đang tải danh mục…</div> : !error && data?.items.length ? <div className={s.tableScroll}><table className={[s.table,s.ownersTable].join(' ')}><thead><tr><th>Bất động sản</th><th>Dự án & khu vực</th><th>Tình trạng</th><th>Sales chính</th><th/></tr></thead><tbody>{data.items.map(p => <tr key={p.id}><td><div className={s.customerCell}><span className={s.propertyIcon}><Building2 size={22}/></span><div><strong>{p.name}</strong><small>{p.code} · {propertyTypeLabels[p.property_type as keyof typeof propertyTypeLabels] || p.property_type}</small></div></div></td><td data-label="Dự án & khu vực"><strong className={s.rowTitle}>{p.project_name}</strong><small>{p.location}</small></td><td data-label="Tình trạng"><span className={s.status}>{publicationLabels[p.publication as keyof typeof publicationLabels] || p.publication}</span><small>{availabilityLabels[p.availability as keyof typeof availabilityLabels] || p.availability}</small></td><td data-label="Sales chính"><strong className={s.rowTitle}>{p.sales_name || 'Chưa có người phụ trách'}</strong><small>{p.sales_id ? p.owner_valid ? 'Đủ điều kiện nhận Lead' : 'Sales hiện chưa hợp lệ' : 'Chưa thể tự phân công Lead'}</small></td><td><button className={s.secondary} onClick={() => setEditing(p)}><Pencil size={14}/> Phân công</button></td></tr>)}</tbody></table></div> : !error && <Empty title="Chưa tìm thấy bất động sản">{query ? 'Thử mã, tên hoặc khu vực khác.' : 'Sản phẩm từ danh mục bất động sản sẽ xuất hiện tại đây.'}</Empty>}
    <footer className={s.panelFooter}><span>{loading ? 'Đang cập nhật…' : (data?.total || 0) + ' bất động sản'}</span><div className={s.pagination}><button className={s.iconButton} disabled={page === 1 || loading} onClick={() => setPage(page - 1)} aria-label="Trang trước"><ChevronLeft size={18}/></button><span>Trang {page} / {Math.max(1, Math.ceil((data?.total || 0) / 15))}</span><button className={s.iconButton} disabled={!data || page * 15 >= data.total || loading} onClick={() => setPage(page + 1)} aria-label="Trang sau"><ChevronRight size={18}/></button></div></footer>
    {editing && <OwnerEditor property={editing} sales={sales} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onSaved(); }}/>}
  </section>;
}
function OwnerEditor({ property, sales, onClose, onSaved }: { property: OwnerProperty; sales: SalesOption[]; onClose: () => void; onSaved: () => void }) {
  const [salesId, setSalesId] = useState(property.sales_id || ''), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [stale, setStale] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await catalogRequest('/api/leads/property-owners/' + property.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sales_id: salesId || null, version: property.owner_version, reason }) });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Chưa thể lưu phân công.'); setStale(e instanceof CatalogRequestError && e.code === 'VERSION_CONFLICT'); }
    finally { setBusy(false); }
  }
  return <Modal title="Sales phụ trách bất động sản" subtitle={property.code + ' · ' + property.name} onClose={onClose}><form onSubmit={submit}><fieldset disabled={busy} className={s.formBody}><label>Sales phụ trách chính<select aria-label="Sales phụ trách chính" value={salesId} onChange={e => setSalesId(e.target.value)}><option value="">Chưa phân công</option>{sales.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>Lý do thay đổi<textarea aria-label="Lý do thay đổi" rows={3} minLength={3} maxLength={1000} required value={reason} onChange={e => setReason(e.target.value)} placeholder="Ghi nhận lý do giao hoặc đổi người phụ trách…"/></label><p className={s.hint}>Chỉ Lead chưa có Sales được xét phân công. Lead đã có Sales giữ nguyên người phụ trách.</p>{error && <div className={s.error} role="alert">{error}{stale && <button type="button" className={s.textButton} onClick={onSaved}>Tải lại danh mục</button>}</div>}<div className={s.formFooter}><button className={s.secondary} type="button" onClick={onClose}>Hủy</button><button className={s.primary} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu người phụ trách'}</button></div></fieldset></form></Modal>;
}
