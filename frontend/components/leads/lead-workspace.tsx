'use client';
import { useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Flame,
  LayoutGrid,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { catalogRequest } from '@/lib/catalog-client';
import { useCrmQuery, useCrmState, useCrmWorkspace } from '../crm/crm-workspace';
import {
  leadBudget,
  leadDate,
  leadSourceLabels,
  leadStatusLabels,
  need,
  routingLabels,
  type Lead,
  type LeadList,
  type SalesOption,
} from '@/lib/leads';
import { propertyTypeLabels } from '@/lib/catalog';
import { LeadDetailDialog } from './lead-detail';
import { PropertyOwners } from './property-owners';
import { Empty, Score, StatusBadge, TemperatureBadge } from './ui';
import s from './leads.module.css';

export function LeadWorkspace() {
  const { role, store } = useCrmWorkspace();
  const [view, setView] = useCrmState<'leads' | 'owners'>('leads.view', 'leads');
  const [search, setSearch] = useCrmState('leads.search', ''),
    [query, setQuery] = useCrmState('leads.query', '');
  const [temperature, setTemperature] = useCrmState('leads.temperature', ''),
    [status, setStatus] = useCrmState('leads.status', '');
  const [assignment, setAssignment] = useCrmState('leads.assignment', ''),
    [salesId, setSalesId] = useCrmState('leads.sales', ''),
    [archived, setArchived] = useCrmState('leads.archived', false);
  const [page, setPage] = useCrmState('leads.page', 1),
    [revision, setRevision] = useState(0);
  const [operationError, setOperationError] = useState(''),
    [notice, setNotice] = useState(''),
    [running, setRunning] = useState(false);
  const [active, setActive] = useState<Lead | null>(null);
  const params = new URLSearchParams({
    page: String(page),
    pageSize: '12',
    archived: String(archived),
    ...(query ? { q: query } : {}),
    ...(temperature ? { temperature } : {}),
    ...(status ? { status } : {}),
    ...(assignment ? { assignment } : {}),
    ...(salesId ? { sales_id: salesId } : {}),
  });
  const result = useCrmQuery<LeadList>('/api/leads?' + params, revision, 'leads', 30000);
  const { data } = result,
    loading = result.loading || result.updating,
    error = operationError || result.error;
  const options = useCrmQuery<{ sales: SalesOption[] }>('/api/leads/options');
  const sales = options.data?.sales || [];
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, query, setQuery, setPage]);
  const refresh = () => {
    setOperationError('');
    store.invalidate();
    setRevision((n) => n + 1);
  };
  const filter = (setter: (v: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };
  const reset = () => {
    setSearch('');
    setQuery('');
    setStatus('');
    setTemperature('');
    setAssignment('');
    setSalesId('');
    setPage(1);
  };
  async function recheck() {
    setRunning(true);
    setNotice('');
    setOperationError('');
    try {
      const result = await catalogRequest<{ queued: number }>('/api/leads/recheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      setNotice('Đã đưa ' + result.queued + ' Lead vào lượt xét phân công. Kết quả sẽ tự cập nhật.');
      refresh();
    } catch (e) {
      setOperationError(e instanceof Error ? e.message : 'Chưa thể xét phân công.');
    } finally {
      setRunning(false);
    }
  }
  const stats = data?.stats;
  return (
    <main className={s.workspace}>
      <div className={s.container}>
        {role === 'Admin' && (
          <nav className={s.moduleTabs} aria-label="Chức năng Quản lý Lead">
            <button
              className={view === 'leads' ? s.moduleTabActive : ''}
              aria-pressed={view === 'leads'}
              onClick={() => setView('leads')}
            >
              Danh sách Lead
            </button>
            <button
              className={view === 'owners' ? s.moduleTabActive : ''}
              aria-pressed={view === 'owners'}
              onClick={() => setView('owners')}
            >
              BĐS & Sales
            </button>
          </nav>
        )}
        <section className={s.hero}>
          <div>
            <span className={s.eyebrow}>
              <span /> KHÔNG GIAN QUẢN LÝ KHÁCH HÀNG
            </span>
            <h1>
              {view === 'owners' ? (
                <>
                  Đúng sản phẩm.
                  <br />
                  <em>Đúng người phụ trách.</em>
                </>
              ) : (
                <>
                  Mỗi nhu cầu.
                  <br />
                  <em>Một kết nối đúng.</em>
                </>
              )}
            </h1>
            <p>
              {view === 'owners'
                ? 'Thiết lập Sales phụ trách từng bất động sản để kết nối nhu cầu khách hàng với đội ngũ tư vấn phù hợp.'
                : 'Hiểu nhu cầu, theo dõi tiềm năng và kết nối khách hàng với Sales phù hợp trong một không gian thống nhất.'}
            </p>
            <div className={s.heroActions}>
              {role === 'Admin' && view === 'leads' && (
                <button className={s.primary} onClick={recheck} disabled={running}>
                  <RefreshCw size={16} className={running ? s.spin : ''} /> Xét phân công
                </button>
              )}
              <button className={s.secondary} onClick={refresh}>
                <RefreshCw size={16} /> Làm mới dữ liệu
              </button>
            </div>
          </div>
          <aside className={s.heroCard}>
            <div className={s.heroCardTop}>
              <span className={s.softIcon}>
                <UsersRound size={21} />
              </span>
              <span>CHĂM SÓC CÓ ĐỊNH HƯỚNG</span>
              <ArrowUpRight size={18} />
            </div>
            <h2>
              Từ nhu cầu đến
              <br />
              cuộc tư vấn phù hợp.
            </h2>
            <div className={s.steps}>
              <span>
                <MessageSquare size={16} /> Hiểu nhu cầu
              </span>
              <ArrowRight size={15} />
              <span>
                <Building2 size={16} /> Khớp BĐS
              </span>
              <ArrowRight size={15} />
              <span>
                <UserRound size={16} /> Kết nối Sales
              </span>
            </div>
            <p>
              <ShieldCheck size={14} /> Hồ sơ và lịch sử theo đúng quyền truy cập
            </p>
          </aside>
        </section>
        {notice && (
          <div className={s.notice} role="status">
            <CircleCheck size={18} />
            <span>{notice}</span>
            <button className={s.iconButton} onClick={() => setNotice('')} aria-label="Đóng thông báo">
              <X size={16} />
            </button>
          </div>
        )}
        {view === 'owners' ? (
          <PropertyOwners sales={sales} revision={revision} onSaved={refresh} />
        ) : (
          <>
            <section className={s.metrics} aria-label="Tổng quan danh sách Lead">
              {[
                {
                  title: 'Tổng Lead',
                  value: stats?.total,
                  icon: UsersRound,
                  note: archived ? 'Trong kho lưu trữ' : 'Hồ sơ đang quản lý',
                  onClick: reset,
                },
                {
                  title: 'Tiềm năng cao',
                  value: stats?.hot,
                  icon: Flame,
                  note: 'Lead được phân loại HOT',
                  onClick: () => filter(setTemperature, 'HOT'),
                },
                {
                  title: 'Chưa phân công',
                  value: stats?.unassigned,
                  icon: ArrowDownLeft,
                  note: 'Cần kết nối người phụ trách',
                  onClick: () => filter(setAssignment, 'unassigned'),
                },
                {
                  title: 'Chưa đánh giá',
                  value: stats?.unrated,
                  icon: LayoutGrid,
                  note: 'Chưa được xếp mức tiềm năng',
                  onClick: () => filter(setTemperature, 'UNRATED'),
                },
              ].map(({ title, value, icon: Icon, note, onClick }) => (
                <button key={title} className={s.metric} onClick={onClick}>
                  <div>
                    <span>{title}</span>
                    <span className={s.metricIcon}>
                      <Icon size={19} />
                    </span>
                  </div>
                  <strong>{value === undefined ? '—' : value.toLocaleString('vi-VN')}</strong>
                  <small>{note}</small>
                </button>
              ))}
            </section>
            <section className={s.panel} aria-labelledby="lead-list-title">
              <div className={s.panelHeader}>
                <div>
                  <span className={s.eyebrow}>KẾT NỐI CÓ GIÁ TRỊ</span>
                  <h2 id="lead-list-title">
                    {archived ? 'Lead đã lưu trữ' : role === 'Admin' ? 'Quản lý Lead' : 'Lead được giao'}{' '}
                    <span className={s.count}>{data?.total ?? '—'}</span>
                  </h2>
                  <p>
                    {role === 'Admin'
                      ? 'Theo dõi hồ sơ, nhu cầu và tiến trình xử lý khách hàng.'
                      : 'Tiếp nhận và theo dõi những khách hàng bạn đang phụ trách.'}
                  </p>
                </div>
                {role === 'Admin' && (
                  <label className={s.archiveToggle}>
                    <input
                      type="checkbox"
                      checked={archived}
                      onChange={(e) => {
                        setArchived(e.target.checked);
                        setPage(1);
                      }}
                    />{' '}
                    Xem lưu trữ
                  </label>
                )}
              </div>
              <div className={s.tabs} aria-label="Lọc mức tiềm năng">
                {[
                  ['', 'Tất cả', stats?.total],
                  ['HOT', 'HOT', stats?.hot],
                  ['WARM', 'WARM', stats?.warm],
                  ['COLD', 'COLD', stats?.cold],
                  ['UNRATED', 'Chưa đánh giá', stats?.unrated],
                ].map(([value, label, count]) => (
                  <button
                    key={String(value)}
                    className={temperature === value ? s.tabActive : ''}
                    onClick={() => filter(setTemperature, String(value))}
                    aria-pressed={temperature === value}
                  >
                    {label}
                    <span>{count ?? '—'}</span>
                  </button>
                ))}
              </div>
              <div className={s.toolbar}>
                <label className={s.searchInput}>
                  <Search size={18} />
                  <input
                    value={search}
                    maxLength={120}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Tìm tên, số điện thoại hoặc email…"
                    aria-label="Tìm Lead"
                  />
                </label>
                <label className={s.filterSelect}>
                  <SlidersHorizontal size={16} />
                  <select
                    value={status}
                    onChange={(e) => filter(setStatus, e.target.value)}
                    aria-label="Lọc trạng thái"
                  >
                    <option value="">Tất cả trạng thái</option>
                    {Object.entries(leadStatusLabels).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <select
                  value={assignment}
                  onChange={(e) => filter(setAssignment, e.target.value)}
                  aria-label="Lọc phân công"
                >
                  <option value="">Tất cả phân công</option>
                  <option value="unassigned">Chưa phân công</option>
                  <option value="assigned">Đã phân công</option>
                </select>
                {role === 'Admin' && (
                  <select value={salesId} onChange={(e) => filter(setSalesId, e.target.value)} aria-label="Lọc Sales">
                    <option value="">Tất cả Sales</option>
                    {sales.map((sale) => (
                      <option key={sale.id} value={sale.id}>
                        {sale.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {error && (
                <div className={s.error} role="alert">
                  {error}
                  <button className={s.textButton} onClick={refresh}>
                    Thử lại
                  </button>
                </div>
              )}
              <div aria-live="polite" aria-busy={loading}>
                {loading && !data ? (
                  <div className={s.loading}>
                    <RefreshCw size={23} className={s.spin} /> Đang tải hồ sơ Lead…
                  </div>
                ) : !error && data?.items.length ? (
                  <div className={s.tableScroll}>
                    <table className={s.table}>
                      <thead>
                        <tr>
                          <th>Khách hàng</th>
                          <th>Nhu cầu & ngân sách</th>
                          <th>Tiềm năng</th>
                          <th>Sales phụ trách</th>
                          <th>Trạng thái</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {data.items.map((lead) => (
                          <LeadRow key={lead.id} lead={lead} onOpen={() => setActive(lead)} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  !error && (
                    <Empty
                      title={
                        query || status || temperature || assignment || salesId
                          ? 'Chưa tìm thấy Lead phù hợp'
                          : archived
                            ? 'Chưa có Lead lưu trữ'
                            : 'Chưa có hồ sơ Lead'
                      }
                    >
                      {query || status || temperature || assignment || salesId ? (
                        <button className={s.textButton} onClick={reset}>
                          Xóa bộ lọc để xem lại
                        </button>
                      ) : (
                        'Hồ sơ sẽ xuất hiện tại đây khi yêu cầu tư vấn được bàn giao.'
                      )}
                    </Empty>
                  )
                )}
              </div>
              <footer className={s.panelFooter}>
                <span>
                  {loading
                    ? 'Đang cập nhật…'
                    : 'Hiển thị ' + (data?.items.length || 0) + ' / ' + (data?.total || 0) + ' Lead'}{' '}
                  · Tự cập nhật mỗi 30 giây
                </span>
                <div className={s.pagination}>
                  <button
                    className={s.iconButton}
                    disabled={page === 1 || loading}
                    onClick={() => setPage(page - 1)}
                    aria-label="Trang trước"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <span>
                    Trang {page} / {Math.max(1, Math.ceil((data?.total || 0) / 12))}
                  </span>
                  <button
                    className={s.iconButton}
                    disabled={!data || page * 12 >= data.total || loading}
                    onClick={() => setPage(page + 1)}
                    aria-label="Trang sau"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </footer>
            </section>
          </>
        )}
        <footer className={s.pageFooter}>
          <span>
            TERAVA <span>·</span> Kết nối bất động sản và khách hàng
          </span>
          <span>
            <ShieldCheck size={14} /> Quyền truy cập được kiểm tra ở mỗi thao tác
          </span>
        </footer>
      </div>
      {active && (
        <LeadDetailDialog lead={active} role={role} sales={sales} onClose={() => setActive(null)} onSaved={refresh} />
      )}
    </main>
  );
}
function LeadRow({ lead, onOpen }: { lead: Lead; onOpen: () => void }) {
  const locations = need<string[]>(lead, 'locations', lead.preferred_location ? [lead.preferred_location] : []);
  const types = need<string[]>(
    lead,
    'property_types',
    lead.preferred_property_type ? [lead.preferred_property_type] : [],
  );
  return (
    <tr>
      <td>
        <div className={s.customerCell}>
          <span className={s.avatar}>{lead.customer.full_name.slice(0, 1).toUpperCase()}</span>
          <div>
            <button className={s.nameButton} onClick={onOpen}>
              {lead.customer.full_name}
            </button>
            <small>{lead.customer.phone}</small>
            <span className={s.sourceLabel}>{leadSourceLabels[lead.source] || 'Yêu cầu tư vấn'}</span>
          </div>
        </div>
      </td>
      <td data-label="Nhu cầu & ngân sách">
        <strong className={s.rowTitle}>
          {types.map((t) => propertyTypeLabels[t as keyof typeof propertyTypeLabels] || t).join(', ') ||
            'Chưa xác định loại BĐS'}
        </strong>
        <small>{locations.join(', ') || 'Chưa xác định khu vực'}</small>
        <span className={s.budgetLabel}>{leadBudget(lead)}</span>
      </td>
      <td data-label="Tiềm năng">
        <TemperatureBadge value={lead.temperature} />
        <Score score={lead.lead_score} temperature={lead.temperature} />
      </td>
      <td data-label="Người phụ trách">
        {lead.assignment ? (
          <>
            <strong className={s.rowTitle}>{lead.assignment.sales_name}</strong>
            <small>
              {!lead.assignment.sales_valid
                ? 'Tài khoản chưa hợp lệ'
                : lead.assignment.accepted
                  ? 'Đã tiếp nhận'
                  : 'Chờ tiếp nhận'}
            </small>
          </>
        ) : (
          <>
            <span className={s.unassigned}>Chưa phân công</span>
            <small className={s.reasonText}>
              {routingLabels[lead.routing?.reason || ''] || 'Đang tìm Sales phù hợp'}
            </small>
          </>
        )}
      </td>
      <td data-label="Trạng thái">
        <StatusBadge value={lead.status} />
        <small className={s.dateLabel}>{leadDate(lead.updated_at)}</small>
      </td>
      <td>
        <button className={s.iconButton} onClick={onOpen} aria-label={'Mở hồ sơ ' + lead.customer.full_name}>
          <ArrowUpRight size={19} />
        </button>
      </td>
    </tr>
  );
}
