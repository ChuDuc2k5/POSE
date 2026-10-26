'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Bot, CalendarDays, Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { catalogRequest } from '@/lib/catalog-client';
import { appointmentChannelName, appointmentDate, appointmentOverdue, appointmentParams, appointmentStatusLabels, initialAppointmentFilters, type AppointmentChoices, type AppointmentFilters, type AppointmentList } from '@/lib/appointments';
import { useCrmState, useCrmWorkspace } from '../crm/crm-workspace';
import { AppointmentDialog } from './appointment-dialog';
import { AppointmentForm } from './appointment-form';
import { AppointmentBadge, AppointmentDetailDialog } from './appointment-detail';
import { useAppointmentResource } from './use-appointment-resource';
import s from './appointments.module.css';
export function AppointmentWorkspace({ today }: { today: string }) {
  const { role } = useCrmWorkspace(), router = useRouter();
  const [filters, setFilters] = useCrmState<AppointmentFilters>('appointments.filters', initialAppointmentFilters(today));
  const [search, setSearch] = useState(filters.q), [revision, setRevision] = useState(0), [active, setActive] = useState<string | null>(null), [creating, setCreating] = useState(false), [now, setNow] = useState(() => Date.now()), [saving, setSaving] = useState(false);
  const invalid = !!filters.date_from && !!filters.date_to && filters.date_from > filters.date_to;
  const { data, loading, error } = useAppointmentResource<AppointmentList>(invalid ? null : '/api/appointments?' + appointmentParams(filters, role), revision);
  const { data: sales, error: salesError } = useAppointmentResource<AppointmentChoices>(role === 'Admin' ? '/api/appointments/options?kind=sales' : null, revision);
  useEffect(() => { if (data && data.role !== role) router.refresh(); }, [data, role, router]);
  useEffect(() => {
    const focus = () => { if (document.visibilityState === 'visible') { setRevision(v => v + 1); setNow(Date.now()); } };
    window.addEventListener('focus', focus); const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => { window.removeEventListener('focus', focus); clearInterval(timer); };
  }, []);
  const refresh = () => { setRevision(v => v + 1); setNow(Date.now()); };
  const update = (key: keyof AppointmentFilters, value: string) => setFilters(old => ({ ...old, [key]: value, page: 1 }));
  const list = data?.role === role ? data : undefined;
  return <main className={s.page}>
    <header className={s.heading}><div><span className={s.eyebrow}>CHĂM SÓC & LỊCH HẸN</span><h1>Lịch hẹn</h1><p>Sắp xếp cuộc gặp, ghi nhận kết quả và theo dõi từng lần thay đổi.</p></div><div className={s.actions}><button className={s.secondary} onClick={refresh}><RefreshCw size={16}/>Làm mới</button><button className={s.primary} onClick={() => setCreating(true)}><Plus size={17}/>Tạo lịch hẹn</button></div></header>
    <p className={s.scope}><ShieldCheck size={16}/>{role === 'Admin' ? 'Toàn bộ lịch hẹn thủ công · Quản lý theo quyền Admin' : 'Lịch hẹn của Lead đang được giao cho bạn'}<small>Giờ Việt Nam · UTC+7</small></p>
    <section className={s.panel}><div className={s.panelTitle}><div><h2><CalendarDays size={18}/>Danh sách lịch hẹn</h2><p>Sắp xếp theo thời gian bắt đầu. Chọn một lịch để xem chi tiết và xử lý.</p></div><button className={s.textButton} onClick={() => { setFilters({ ...initialAppointmentFilters(today), date_from: '' }); setSearch(''); }}>Xem toàn bộ / xóa bộ lọc</button></div>
      <div className={s.filters}><form className={s.search} onSubmit={e => { e.preventDefault(); update('q', search.trim()); }}><Search size={16}/><input aria-label="Tìm lịch hẹn" placeholder="Tên khách, số điện thoại, nội dung…" maxLength={120} value={search} onChange={e => setSearch(e.target.value)}/><button>Tìm</button></form><label>Từ ngày<input aria-label="Từ ngày" type="date" value={filters.date_from} onChange={e => update('date_from', e.target.value)}/></label><label>Đến ngày<input aria-label="Đến ngày" type="date" value={filters.date_to} onChange={e => update('date_to', e.target.value)}/></label><label>Trạng thái<select aria-label="Trạng thái lịch hẹn" value={filters.status} onChange={e => update('status', e.target.value)}><option value="">Tất cả trạng thái</option>{Object.entries(appointmentStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{role === 'Admin' && <label>Sales phụ trách<select aria-label="Sales phụ trách" value={filters.sales_id} onChange={e => update('sales_id', e.target.value)}><option value="">Tất cả Sales</option>{sales?.items.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>}</div>
      {salesError && <p className={s.error} role="alert">{salesError}<button onClick={refresh}>Thử lại</button></p>}
      <div aria-live="polite" aria-busy={loading}>{invalid ? <p className={s.error} role="alert">Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.</p> : error ? <div className={s.error} role="alert">{error}<button onClick={refresh}>Thử lại</button></div> : loading ? <div className={s.loading} role="status">Đang tải lịch hẹn…</div> : list && (list.items.length ? <><div className={s.tableWrap}><table><thead><tr><th>Cuộc hẹn / khách hàng</th><th>Thời gian</th><th>Hình thức</th>{role === 'Admin' && <th>Sales phụ trách</th>}<th>Trạng thái</th><th><span className={s.srOnly}>Thao tác</span></th></tr></thead><tbody>{list.items.map(item => <tr key={item.id}><td><button className={s.customer} onClick={() => setActive(item.id)}><strong>{item.title}</strong><span>{item.customer.name}</span></button><small>{item.customer.phone}</small>{item.property && <small>{item.property.code} · {item.property.name}</small>}</td><td><strong>{appointmentDate(item.starts_at)}</strong><small>Đến {appointmentDate(item.ends_at)}</small>{appointmentOverdue(item, now) && <span className={s.overdue}>Đã qua giờ hẹn</span>}</td><td>{appointmentChannelName(item.channel)}<small>{item.channel === 'Phone' ? item.customer.phone : item.location}</small></td>{role === 'Admin' && <td>{item.sales_name}</td>}<td><AppointmentBadge status={item.status}/>{item.lead_archived || ['CONVERTED', 'LOST'].includes(item.lead_status) ? <small>Lead đã kết thúc / lưu trữ</small> : null}</td><td><button className={s.iconButton} aria-label={'Mở lịch ' + item.title} onClick={() => setActive(item.id)}><ArrowUpRight size={18}/></button></td></tr>)}</tbody></table></div><div className={s.paging}><span>{list.total.toLocaleString('vi-VN')} lịch hẹn · Trang {filters.page}/{Math.max(1, Math.ceil(list.total / 12))}</span><div><button disabled={filters.page === 1} onClick={() => setFilters(old => ({ ...old, page: old.page - 1 }))}>Trước</button><button disabled={filters.page * 12 >= list.total} onClick={() => setFilters(old => ({ ...old, page: old.page + 1 }))}>Sau</button></div></div></> : <div className={s.empty}><CalendarDays size={35}/><h3>Chưa có lịch hẹn phù hợp</h3><p>Tạo lịch mới hoặc điều chỉnh bộ lọc để xem các cuộc hẹn khác.</p></div>)}</div>
    </section>
    <section className={s.botPlaceholder} aria-label="Lịch hẹn từ chatbot"><Bot size={23}/><div><h2>Lịch hẹn từ chatbot <span>Chưa kết nối M06</span></h2><p>Phần này hiện chỉ có giao diện chờ kết nối. Danh sách phía trên chỉ quản lý lịch do Sales/Admin tạo.</p></div></section>
    {creating && <AppointmentDialog title="Tạo lịch hẹn" subtitle="Sales phụ trách lấy từ phân công hiện tại của Lead." onClose={() => setCreating(false)} busy={saving}><AppointmentForm action="create" role={role} onCancel={() => setCreating(false)} onReload={refresh} onBusy={setSaving} onSave={async (payload, reason) => { const response = await catalogRequest<{ item: { id: string } }>('/api/appointments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: payload, reason }) }); setCreating(false); refresh(); setActive(response.item.id); }}/></AppointmentDialog>}
    {active && <AppointmentDetailDialog id={active} role={role} onClose={() => setActive(null)} onChanged={refresh}/>}
  </main>;
}
