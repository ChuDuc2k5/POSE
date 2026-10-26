'use client';
import { useState } from 'react';
import { Search, X } from 'lucide-react';
import type { AppointmentChoice, AppointmentChoices } from '@/lib/appointments';
import { useAppointmentResource } from './use-appointment-resource';
import s from './appointments.module.css';
export function AppointmentPicker({ kind, value, leadId, onChange }: { kind: 'leads' | 'properties'; value: AppointmentChoice | null; leadId?: string; onChange: (v: AppointmentChoice | null) => void }) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const label = kind === 'leads' ? 'Lead / khách hàng' : 'BĐS liên quan';
  const { data, loading, error } = useAppointmentResource<AppointmentChoices>(open ? '/api/appointments/options?' + new URLSearchParams({ kind, q: query, page: String(page), ...(leadId ? { lead_id: leadId } : {}) }) : null, revision);
  return <div className={s.picker}><span className={s.label}>{label}{kind === 'leads' ? ' *' : ' (tùy chọn)'}</span>
    {value ? <div className={s.selection}><span><strong>{value.code ? value.code + ' · ' : ''}{value.name}</strong><small>{value.sales_name ? `Sales: ${value.sales_name}` : value.location || value.phone}</small></span><button type="button" className={s.iconButton} aria-label={'Bỏ chọn ' + label} onClick={() => { onChange(null); setOpen(false); }}><X size={16}/></button></div> : <button type="button" className={s.selectButton} onClick={() => setOpen(v => !v)} disabled={kind === 'properties' && !leadId}><Search size={16}/>{kind === 'properties' && !leadId ? 'Chọn Lead trước' : 'Chọn ' + label}</button>}
    {open && <div className={s.pickerPanel}><div className={s.pickerSearch}><input aria-label={'Tìm ' + label} placeholder="Nhập tên, số điện thoại hoặc mã…" maxLength={120} value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setQuery(search.trim()); setPage(1); } }}/><button type="button" onClick={() => { setQuery(search.trim()); setPage(1); setRevision(v => v + 1); }}>Tìm</button></div>
      {loading ? <p role="status">Đang tải danh mục…</p> : error ? <p role="alert">{error}<button type="button" onClick={() => setRevision(v => v + 1)}>Thử lại</button></p> : <><div className={s.pickerResults}>{data?.items.map(choice => <button key={choice.id} type="button" onClick={() => { onChange(choice); setOpen(false); }}><strong>{choice.code ? choice.code + ' · ' : ''}{choice.name}</strong><small>{choice.sales_name ? `${choice.phone || 'Chưa có số điện thoại'} · Sales: ${choice.sales_name}` : choice.location}</small>{(choice.archived || ['CONVERTED', 'LOST'].includes(choice.status || '')) && <small>Lead đã kết thúc/lưu trữ · Admin cần ghi lý do</small>}</button>)}</div>{!data?.items.length && <p>Chưa có lựa chọn phù hợp trong phạm vi được phép.</p>}
      {(data?.total || 0) > 20 && <div className={s.paging}><button type="button" disabled={page === 1} onClick={() => setPage(v => v - 1)}>Trước</button><span>Trang {page}</span><button type="button" disabled={page * 20 >= (data?.total || 0)} onClick={() => setPage(v => v + 1)}>Sau</button></div>}</>}
      <button type="button" className={s.textButton} onClick={() => setOpen(false)}>Đóng danh mục</button>
    </div>}
  </div>;
}
