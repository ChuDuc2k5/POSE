'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChartColumn, CircleCheck, Download, RefreshCw, RotateCcw, ShieldCheck, SlidersHorizontal, UserRoundSearch, UsersRound } from 'lucide-react';
import { catalogRequest, CatalogRequestError } from '@/lib/catalog-client';
import { leadDate, leadStatusLabels, temperatureLabels } from '@/lib/leads';
import { initialReportFilters, reportDate, reportParams, reportPeriods, reportRange, reportRangeError, resolvedReportFilters, vietnamToday, type LeadReport, type ReportFilters, type ReportOptions, type ReportPeriod } from '@/lib/reports';
import { useCrmState, useCrmWorkspace } from '../crm/crm-workspace';
import { ChartEmpty, StatusChart, TemperatureChart, TrendChart } from './report-charts';
import s from './reports.module.css';

export function ReportWorkspace({ today }: { today: string }) {
  const { role } = useCrmWorkspace(), router = useRouter();
  const [savedFilters, setFilters] = useCrmState<ReportFilters>('reports.filters', initialReportFilters(today));
  const [clockDay, setClockDay] = useState(today);
  const filters = resolvedReportFilters(savedFilters, clockDay);
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{ key: string; query: string; data: LeadReport | null; error: string } | null>(null);
  const [options, setOptions] = useState<ReportOptions | null>(null), [optionsError, setOptionsError] = useState('');
  const rangeError = reportRangeError(filters.date_from, filters.date_to, clockDay);
  const query = reportParams(filters, role).toString(), key = JSON.stringify([query, revision]);
  const data = !rangeError && response?.query === query ? response.data : null;
  const error = !rangeError && response?.key === key ? response.error : '';
  const loading = !rangeError && response?.key !== key;
  const initialLoading = loading && !data;
  useEffect(() => {
    if (rangeError) return;
    const controller = new AbortController();
    catalogRequest<LeadReport>('/api/reports/leads?' + query, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      if (result.scope.role !== role) { router.refresh(); return; }
      setResponse({ key, query, data: result, error: '' });
    }).catch(e => {
      if (controller.signal.aborted) return;
      setResponse({ key, query, data: null, error: e instanceof Error ? e.message : 'Chưa thể tải báo cáo.' });
      if (e instanceof CatalogRequestError && ['UNAUTHORIZED', 'FORBIDDEN'].includes(e.code)) router.refresh();
    });
    return () => controller.abort();
  }, [query, key, rangeError, role, router]);
  useEffect(() => {
    const controller = new AbortController();
    catalogRequest<ReportOptions>('/api/reports/options', { signal: controller.signal }).then(result => { if (!controller.signal.aborted) { setOptions(result); setOptionsError(''); } }).catch(e => { if (!controller.signal.aborted) setOptionsError(e.message || 'Chưa thể tải danh sách Sales.'); });
    return () => controller.abort();
  }, [revision]);
  const refresh = useCallback(() => { setClockDay(vietnamToday()); setRevision(v => v + 1); }, [setClockDay, setRevision]);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = setInterval(visible, 30000); window.addEventListener('focus', visible);
    return () => { clearInterval(timer); window.removeEventListener('focus', visible); };
  }, [refresh]);
  function update<K extends keyof ReportFilters>(field: K, value: ReportFilters[K]) { setFilters(old => ({ ...old, [field]: value })); }
  function period(value: ReportPeriod) { const day = vietnamToday(); setClockDay(day); setFilters(old => ({ ...old, period: value, ...(value === 'custom' ? { date_from: filters.date_from, date_to: filters.date_to } : reportRange(value, day)) })); }
  function reset() { const day = vietnamToday(); setClockDay(day); setFilters(initialReportFilters(day)); }
  const stats = data?.stats;
  const cards = [
    { key: 'total', title: 'Lead phát sinh', value: stats?.total, description: 'Được tạo trong khoảng thời gian đã lọc.', Icon: UsersRound },
    { key: 'converted', title: 'Lead đã chuyển đổi', value: stats?.converted, description: 'Trong nhóm Lead tạo trong kỳ, hiện đã mua thành công.', Icon: CircleCheck },
    ...(role === 'Admin' ? [{ key: 'unassigned', title: 'Lead chưa phân công', value: stats?.unassigned, description: 'Lead đang mở, chưa có Sales phụ trách.', Icon: UserRoundSearch }] : []),
  ];
  return <main className={s.page}>
    <header className={s.heading}><div><span className={s.eyebrow}>KẾT QUẢ NGHIỆP VỤ</span><h1>Báo cáo Lead</h1><p>Theo dõi Lead và kết quả chuyển đổi trong phạm vi được phép xem.</p></div><button type="button" className={s.secondary} onClick={refresh} disabled={loading}><RefreshCw size={16} className={loading ? s.spin : ''}/>Làm mới</button></header>
    <div className={s.scope}><ShieldCheck size={16}/><span>{role === 'Admin' ? 'Dữ liệu toàn hệ thống · Có thể lọc theo Sales phụ trách' : 'Dữ liệu Lead được giao cho bạn'}</span><small>Giờ Việt Nam · UTC+7</small></div>
    <section className={s.filters} aria-labelledby="report-filter-title"><div className={s.filterHeading}><h2 id="report-filter-title"><SlidersHorizontal size={16}/>Bộ lọc báo cáo</h2><button type="button" onClick={reset}><RotateCcw size={14}/>Đặt lại bộ lọc</button></div><div className={s.filterGrid}>
      <label>Khoảng thời gian<select aria-label="Khoảng thời gian" value={filters.period} onChange={e => period(e.target.value as ReportPeriod)}>{Object.entries(reportPeriods).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Trạng thái Lead<select aria-label="Trạng thái Lead" value={filters.status} onChange={e => update('status', e.target.value)}><option value="">Tất cả trạng thái</option>{Object.entries(leadStatusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Mức tiềm năng<select aria-label="Mức tiềm năng" value={filters.temperature} onChange={e => update('temperature', e.target.value)}><option value="">Tất cả mức tiềm năng</option>{Object.entries(temperatureLabels).map(([k, v]) => <option key={k} value={k}>{k === 'UNRATED' ? v : `${k} · ${v}`}</option>)}</select></label>
      <label>Lưu trữ<select aria-label="Lưu trữ" value={filters.archived} onChange={e => update('archived', e.target.value as ReportFilters['archived'])}><option value="all">Tất cả hồ sơ</option><option value="false">Chưa lưu trữ</option><option value="true">Đã lưu trữ</option></select></label>
      {role === 'Admin' && <label>Sales phụ trách<select aria-label="Sales phụ trách" value={filters.sales_id} onChange={e => update('sales_id', e.target.value)}><option value="">Tất cả Sales</option>{!(options?.sales ?? []).some(v => v.id === filters.sales_id) && filters.sales_id && <option value={filters.sales_id}>Sales đã chọn</option>}{(options?.sales ?? []).map(v => <option key={v.id} value={v.id}>{v.name}{v.active ? '' : ' (Ngừng hoạt động)'}</option>)}</select></label>}
    </div>{filters.period === 'custom' && <div className={s.customDates}><label>Từ ngày<input aria-label="Từ ngày" type="date" required max={clockDay} value={filters.date_from} onChange={e => update('date_from', e.target.value)}/></label><span>→</span><label>Đến ngày<input aria-label="Đến ngày" type="date" required max={clockDay} value={filters.date_to} onChange={e => update('date_to', e.target.value)}/></label></div>}
      {rangeError ? <p className={s.error} role="alert">{rangeError}</p> : <p className={s.filterSummary}>{reportDate(filters.date_from)} — {reportDate(filters.date_to)}<span>Trạng thái và mức tiềm năng tại thời điểm xem báo cáo</span></p>}
      {role === 'Admin' && optionsError && <p className={s.optionsError} role="alert">{optionsError} <button onClick={refresh}>Thử tải lại</button></p>}
    </section>
    {error && <div className={s.error} role="alert">{error}<button type="button" onClick={refresh}>Thử lại</button></div>}
    <section className={s.cards} aria-label="Chỉ số Lead" aria-busy={loading} style={{ gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))` }}>{cards.map(({ key: metric, title, value, description, Icon }) => <article key={metric} className={s.metric} data-report-metric={metric}><div><h2>{title}</h2><span><Icon size={20}/></span></div><strong aria-label={title + ': ' + (value === undefined ? 'Chưa có số liệu' : value.toLocaleString('vi-VN'))}>{value === undefined ? '—' : value.toLocaleString('vi-VN')}</strong><p>{description}</p></article>)}</section>
    <section className={s.charts} aria-label="Biểu đồ Lead" aria-busy={loading}>
      <article className={s.chart}><div className={s.chartHeading}><h2>Phân bố trạng thái</h2><p>Trạng thái hiện tại của nhóm Lead đã lọc.</p></div>{initialLoading ? <div className={s.chartSkeleton} role="status">Đang tải biểu đồ…</div> : data ? <StatusChart rows={data.statuses}/> : <div className={s.noChart}>Chọn bộ lọc hợp lệ và tải báo cáo để xem số liệu.</div>}</article>
      <article className={s.chart}><div className={s.chartHeading}><h2>Phân bố mức tiềm năng</h2><p>Gồm cả Lead chưa được đánh giá.</p></div>{initialLoading ? <div className={s.chartSkeleton} role="status">Đang tải biểu đồ…</div> : data ? <TemperatureChart rows={data.temperatures}/> : <div className={s.noChart}>Chưa có số liệu để hiển thị.</div>}</article>
      <article className={`${s.chart} ${s.trend}`}><div className={s.chartHeading}><div><h2>Lead phát sinh theo thời gian</h2><p>Số Lead được tạo theo {data?.bucket === 'month' ? 'tháng' : 'ngày'}, theo giờ Việt Nam.</p></div><ChartColumn size={21}/></div>{initialLoading ? <div className={s.chartSkeleton} role="status">Đang tải biểu đồ…</div> : data ? data.stats.total ? <TrendChart data={data.trend} bucket={data.bucket}/> : <ChartEmpty/> : <div className={s.noChart}>Chưa có số liệu để hiển thị.</div>}</article>
    </section>
    <footer className={s.footer}><span>{data ? `Cập nhật lúc ${leadDate(data.generated_at)}` : 'Số liệu cập nhật theo bộ lọc'} · Tự làm mới mỗi 30 giây</span><div><Download size={15}/><span>Xuất báo cáo sẽ được bổ sung ở giai đoạn tiếp theo.</span></div></footer>
  </main>;
}
