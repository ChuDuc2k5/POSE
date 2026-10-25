'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUpRight, Building2, CheckCheck, ClipboardList, MessageSquare, RefreshCw, Search, ShieldCheck, UsersRound, CalendarDays } from 'lucide-react';
import { useCrmQuery, useCrmState, useCrmWorkspace } from '../crm/crm-workspace';
import { leadBudget, leadDate, leadStatusLabels, temperatureLabels } from '@/lib/leads';
import { availabilityLabels, propertyTypeLabels, publicationLabels } from '@/lib/catalog';
import { channelLabels, type Activity, type Page, type SalesAppointment, type SalesLeadList, type SalesOptions, type SalesProperty } from '@/lib/sales';
import { Empty, Score, StatusBadge } from '../leads/ui';
import { ActivityCards, Pagination, SalesDetailDialog } from './sales-detail';
import { PropertyCards, PropertyDialog } from './sales-properties';
import s from './sales.module.css';

// `extra` renders page-level sections (M08 assigned calls) inside the workspace, above the footer.
export function SalesWorkspace({ extra }: { extra?: ReactNode }) {
  const { role, store } = useCrmWorkspace();
  const [view, setView] = useCrmState('sales.view', 'assigned'), [catalog, setCatalog] = useCrmState('sales.catalog', 'leads'), [search, setSearch] = useCrmState('sales.search', ''), [query, setQuery] = useCrmState('sales.query', '');
  const [filters, setFilters] = useCrmState<Record<string, string>>('sales.filters', {}), [sales, setSales] = useCrmState('sales.sales', '');
  const [page, setPage] = useCrmState('sales.page', 1);
  const [active, setActive] = useState<{ id: string; tab: string } | null>(null), [property, setProperty] = useState<string | null>(null);
  const kind = view === 'activities' ? 'activities' : view === 'results' ? 'leads' : catalog;
  const params = new URLSearchParams({ ...filters, ...(query ? { q: query } : {}), ...(sales ? { sales_id: sales } : {}), page: String(page), pageSize: '12' });
  const { data, loading, error, updating } = useCrmQuery<SalesLeadList | Page<SalesProperty> | Page<Activity>>('/api/sales/' + kind + '?' + params, 0, 'sales');
  const { data: options } = useCrmQuery<SalesOptions>('/api/sales/options');
  const { data: appointments } = useCrmQuery<SalesAppointment[]>('/api/sales/appointments' + (role === 'Admin' && sales ? `?sales_id=${encodeURIComponent(sales)}` : ''), 0, 'sales');
  const refresh = () => store.invalidate();
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search, query, setQuery, setPage]);
  function navigate(next: string, nextCatalog = catalog) { setView(next); setCatalog(nextCatalog); setFilters({}); setSearch(''); setQuery(''); setPage(1); }
  function filter(k: string, value: string) { setFilters(old => { const f = { ...old }; if (value) f[k] = value; else delete f[k]; return f; }); setPage(1); }
  const select = (k: string, label: string, values: Record<string, string>) => <select aria-label={label} value={filters[k] || ''} onChange={e => filter(k, e.target.value)}><option value="">{label}</option>{Object.entries(values).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select>;
  const stats = kind === 'leads' && data && 'stats' in data ? data.stats : null;
  return <main className={s.workspace}>
    <div className={s.container}><section className={s.hero}><div><span className={s.eyebrow}>TERAVA · SALES WORKSPACE</span><h1>Hiểu khách hàng.<br/><em>Đồng hành đúng nhu cầu.</em></h1><p>{role === 'Admin' ? 'Theo dõi danh mục, hoạt động tư vấn và kết quả của đội ngũ Sales.' : 'Danh mục được giao, các cuộc tư vấn và kết quả chăm sóc trong một không gian.'}</p><button className={s.secondary} onClick={refresh}><RefreshCw size={16}/>Làm mới dữ liệu</button></div><aside><div className={s.heroIcon}><MessageSquare size={26}/><ArrowUpRight size={20}/></div><h2>Mỗi cuộc tư vấn,<br/>một bước gần hơn.</h2><p>Ghi nhận trao đổi · Xác nhận nhu cầu<br/>Theo dõi kết quả</p><small><ShieldCheck size={14}/>{role === 'Admin' ? 'Chế độ giám sát · Chỉ xem' : 'Danh mục và hồ sơ theo quyền được giao'}</small></aside></section>
      <nav className={s.mainTabs} aria-label="Chức năng Sales">{[['assigned', 'Danh mục được giao', ClipboardList], ['activities', 'Hoạt động tư vấn', MessageSquare], ['results', 'Nhu cầu & kết quả', CheckCheck]].map(([k, label, Icon]) => { const I = Icon as typeof ClipboardList; return <button key={String(k)} className={view === k ? s.selected : ''} onClick={() => navigate(String(k))}><I size={18}/>{String(label)}</button>; })}</nav>
      {kind === 'leads' && <section className={s.stats} aria-label="Tổng quan danh mục Lead">{[['Lead được giao', stats?.total, UsersRound], ['Đang chăm sóc', stats?.open, MessageSquare], ['Đã kết thúc', stats?.closed, CheckCheck], ['Chưa tiếp nhận', stats?.unaccepted, ClipboardList]].map(([label, value, Icon]) => { const I = Icon as typeof UsersRound; return <div key={String(label)}><span>{String(label)}<I size={18}/></span><strong>{loading ? '—' : value?.toLocaleString('vi-VN') ?? '—'}</strong></div>; })}</section>}
      <section className={s.panel} aria-busy={updating}><div className={s.sectionTitle}><div><span className={s.eyebrow}>{view === 'results' ? 'XÁC NHẬN VỚI KHÁCH HÀNG' : view === 'activities' ? 'LỊCH SỬ TRAO ĐỔI' : 'DANH MỤC CỦA BẠN'}</span><h2>{view === 'activities' ? 'Hoạt động tư vấn' : view === 'results' ? 'Nhu cầu và kết quả' : 'Danh mục được giao'}</h2></div>{view === 'assigned' && <div className={s.segment}><button className={catalog === 'leads' ? s.selected : ''} onClick={() => navigate('assigned', 'leads')}><UsersRound size={15}/>Lead</button><button className={catalog === 'properties' ? s.selected : ''} onClick={() => navigate('assigned', 'properties')}><Building2 size={15}/>Bất động sản</button></div>}</div>
        <div className={s.filters}><div className={s.search}><Search size={17}/><input aria-label="Tìm kiếm danh mục" value={search} maxLength={120} onChange={e => setSearch(e.target.value)} placeholder={kind === 'leads' ? 'Tên, số điện thoại hoặc email…' : kind === 'properties' ? 'Mã, tên hoặc khu vực BĐS…' : 'Tên khách, nội dung tư vấn…'}/></div>{role === 'Admin' && <select aria-label="Lọc Sales" value={sales} onChange={e => { setSales(e.target.value); setPage(1); }}><option value="">Tất cả Sales</option>{options?.sales.map(o => <option key={o.id} value={o.id}>{o.name}{o.active ? '' : ' (Ngừng hoạt động)'}</option>)}</select>}
          {kind === 'leads' && <>{select('status', 'Tất cả trạng thái', leadStatusLabels)}{select('temperature', 'Mức tiềm năng', temperatureLabels)}{select('archived', 'Hồ sơ hiện tại', { true: 'Đã lưu trữ' })}</>}
          {kind === 'properties' && <>{select('property_type', 'Tất cả loại BĐS', propertyTypeLabels)}{select('availability', 'Tình trạng sản phẩm', availabilityLabels)}{select('publication', 'Trạng thái công bố', publicationLabels)}</>}
          {kind === 'activities' && <>{select('channel', 'Tất cả kênh', channelLabels)}{select('cancelled', 'Tất cả ghi nhận', { false: 'Còn hiệu lực', true: 'Đã hủy' })}</>}
        </div>
        {updating && !loading && <p className={s.hint} role="status">Đang cập nhật dữ liệu…</p>}
        {error && !loading ? <div className={s.error} role="alert">{error}<button onClick={refresh}>Thử lại</button></div> : loading ? <div className={s.loading} role="status"><RefreshCw size={20}/>Đang tải danh mục…</div> : data && <>
          {kind === 'leads' && (data.items.length ? <div className={s.tableWrap}><table><thead><tr><th>Khách hàng</th><th>Nhu cầu & ngân sách</th><th>Tiềm năng</th><th>Trạng thái</th><th>Tư vấn gần nhất</th><th/></tr></thead><tbody>{(data as SalesLeadList).items.map(l => <tr key={l.id}><td><button className={s.customer} onClick={() => setActive({ id: l.id, tab: view === 'results' ? 'needs' : 'activities' })}><span className={s.avatar}>{l.customer.full_name.slice(0, 1)}</span><span><strong>{l.customer.full_name}</strong><small>{l.customer.phone}</small>{role === 'Admin' && <small>{l.assignment?.sales_name}</small>}</span></button></td><td><strong>{leadBudget(l)}</strong><small>{l.preferred_location || 'Chưa xác định khu vực'}</small></td><td><Score score={l.lead_score} temperature={l.temperature}/></td><td><StatusBadge value={l.status}/><small>{l.assignment?.accepted ? 'Đã tiếp nhận' : 'Chưa tiếp nhận'}</small></td><td>{l.last_activity_at ? leadDate(l.last_activity_at) : 'Chưa có trao đổi'}<small>{l.activity_count} ghi nhận</small></td><td><button className={s.icon} aria-label={'Mở hồ sơ ' + l.customer.full_name} onClick={() => setActive({ id: l.id, tab: view === 'results' ? 'needs' : 'activities' })}><ArrowUpRight size={19}/></button></td></tr>)}</tbody></table></div> : <Empty title="Chưa có Lead trong danh mục">Lead được phân công sẽ xuất hiện tại đây. Có thể thử điều chỉnh bộ lọc.</Empty>)}
          {kind === 'properties' && <PropertyCards items={(data as Page<SalesProperty>).items} onOpen={setProperty}/>}
          {kind === 'activities' && <ActivityCards items={(data as Page<Activity>).items} onOpen={id => setActive({ id, tab: 'activities' })}/>}
          <Pagination page={page} total={data.total} onChange={setPage}/>
        </>}
      </section><section className={s.panel} aria-label="Lịch hẹn sắp tới"><div className={s.sectionTitle}><div><span className={s.eyebrow}>LỊCH HẸN SẮP TỚI</span><h2><CalendarDays size={20}/> Lịch hẹn sắp tới</h2></div></div>{appointments?.length ? <div className={s.activityList}>{appointments.map(a => <article className={s.activity} key={a.id}><div className={s.activityTop}><time dateTime={a.appointment_time}>{new Date(a.appointment_time).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</time><span className={s.cancelBadge}>{a.status}</span></div><strong>{a.property_name || 'Bất động sản'}{a.property_code && ` · ${a.property_code}`}</strong><p>{a.customer_name} · <a href={'tel:'+a.phone}>{a.phone}</a></p>{a.note && <p className={s.pre}>{a.note}</p>}{role === 'Admin' && a.sales_name && <small>Sales: {a.sales_name}</small>}</article>)}</div> : <Empty title="Chưa có lịch hẹn sắp tới">Lịch đặt từ Trợ lý AI sẽ xuất hiện tại đây.</Empty>}</section>{extra}<footer className={s.pageFooter}>TERAVA · Không gian Sales<span>{role === 'Admin' ? 'Theo dõi đội ngũ theo quyền quản trị' : 'Dữ liệu thuộc danh mục được phân công'}</span></footer>
    </div>{active && <SalesDetailDialog key={active.id} id={active.id} role={role} initialTab={active.tab} onClose={() => setActive(null)} onChanged={refresh}/>} {property && <PropertyDialog id={property} onClose={() => setProperty(null)}/>}</main>;
}
