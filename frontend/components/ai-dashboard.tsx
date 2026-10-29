'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Activity, ChevronDown, ChevronRight, Coins, Gauge, MessageSquare, RefreshCw } from 'lucide-react';
import { AdminWorkspaceShell } from './admin-workspace-shell';
import { catalogRequest } from '@/lib/catalog-client';

/** Display-only exchange rate; costs are stored in USD. */
const USD_VND = 26000;
type Period = {
  period: 'today' | 'week' | 'month';
  questions: number;
  calls: number;
  total_tokens: number;
  cost_usd: number;
  avg_turn_latency_ms: number | null;
  p95_turn_latency_ms: number | null;
  error_fallback_rate: number;
  local_tokens: number;
  local_calls: number;
  log_started_at: string | null;
};
type Point = { bucket_start: string; questions: number; calls: number; total_tokens: number; cost_usd: number };
type KindRow = {
  kind: string;
  model: string;
  calls: number;
  total_tokens: number;
  cost_usd: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  error_rate: number;
};
type ModelRow = {
  model: string;
  provider: 'OpenAI' | 'Local';
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  avg_latency_ms: number;
};
type Turn = {
  turn_id: string;
  started_at: string;
  question_preview: string | null;
  calls: number;
  tools: string[];
  prompt_versions: string[];
  total_tokens: number;
  cost_usd: number;
  turn_latency_ms: number;
  worst_status: string;
};
type Call = {
  id: string;
  created_at: string;
  kind: string;
  model: string;
  prompt_version: string | null;
  tools_called: string[];
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  latency_ms: number;
  status: string;
  error_code: string | null;
};
type Bucket = 'day' | 'week' | 'month';

const periods: { key: Period['period']; label: string }[] = [
  { key: 'today', label: 'Hôm nay' },
  { key: 'week', label: 'Tuần này' },
  { key: 'month', label: 'Tháng này' },
];
const buckets: { key: Bucket; label: string; count: number }[] = [
  { key: 'day', label: 'Ngày', count: 30 },
  { key: 'week', label: 'Tuần', count: 12 },
  { key: 'month', label: 'Tháng', count: 12 },
];
const kindLabels: Record<string, string> = {
  query: 'Hiểu câu hỏi',
  rerank: 'Xếp hạng lại',
  chat: 'Trả lời',
  answer_meta: 'Kiểm tra trích dẫn',
  needs: 'Trích nhu cầu',
  embed: 'Embedding',
};
const statusLabels: Record<string, string> = {
  ok: 'Thành công',
  fallback: 'Dự phòng',
  timeout: 'Hết thời gian',
  invalid_json: 'JSON lỗi',
  error: 'Lỗi',
};

const num = (value: unknown) => Number(value) || 0;
const tokens = (value: unknown) => num(value).toLocaleString('vi-VN');
const usd = (value: unknown) =>
  `$${num(value).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`;
const vnd = (value: unknown) => `≈ ${Math.round(num(value) * USD_VND).toLocaleString('vi-VN')} đ`;
const ms = (value: unknown) =>
  value == null
    ? '—'
    : num(value) >= 1000
      ? `${(num(value) / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} s`
      : `${Math.round(num(value))} ms`;
const percent = (value: unknown) => `${(num(value) * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
const logDate = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleDateString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '…';

/** Start of the bucket containing `date`, in Asia/Ho_Chi_Minh (UTC+7, no DST); weeks start on Monday. */
function bucketStart(date: Date, bucket: Bucket) {
  const local = new Date(date.getTime() + 7 * 3600_000);
  local.setUTCHours(0, 0, 0, 0);
  if (bucket === 'week') local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7));
  if (bucket === 'month') local.setUTCDate(1);
  return new Date(local.getTime() - 7 * 3600_000);
}
function shift(date: Date, bucket: Bucket, steps: number) {
  const local = new Date(date.getTime() + 7 * 3600_000);
  if (bucket === 'day') local.setUTCDate(local.getUTCDate() + steps);
  if (bucket === 'week') local.setUTCDate(local.getUTCDate() + 7 * steps);
  if (bucket === 'month') local.setUTCMonth(local.getUTCMonth() + steps);
  return new Date(local.getTime() - 7 * 3600_000);
}
function bucketLabel(iso: string, bucket: Bucket) {
  const local = new Date(new Date(iso).getTime() + 7 * 3600_000);
  const dd = String(local.getUTCDate()).padStart(2, '0'),
    mm = String(local.getUTCMonth() + 1).padStart(2, '0');
  return bucket === 'month' ? `${mm}/${local.getUTCFullYear()}` : `${dd}/${mm}`;
}

function UsageChart({ points, bucket }: { points: Point[]; bucket: Bucket }) {
  const width = 760,
    height = 240,
    left = 56,
    right = 70,
    top = 16,
    bottom = 34;
  const plotW = width - left - right,
    plotH = height - top - bottom;
  const maxTokens = Math.max(1, ...points.map((p) => num(p.total_tokens)));
  const maxCost = Math.max(0, ...points.map((p) => num(p.cost_usd)));
  const slot = plotW / Math.max(points.length, 1),
    bar = Math.max(4, Math.min(28, slot * 0.6));
  const x = (i: number) => left + slot * i + slot / 2;
  const yTokens = (v: number) => top + plotH - (plotH * v) / maxTokens;
  const yCost = (v: number) => top + plotH - (maxCost > 0 ? (plotH * v) / maxCost : 0);
  const line = points
    .map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yCost(num(p.cost_usd)).toFixed(1)}`)
    .join(' ');
  const labelEvery = Math.ceil(points.length / 10);
  return (
    <div className="ai-dash-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Biểu đồ token và chi phí theo ${buckets.find((b) => b.key === bucket)?.label.toLowerCase()}`}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={left}
              x2={width - right}
              y1={top + plotH * (1 - f)}
              y2={top + plotH * (1 - f)}
              className="ai-dash-chart-grid"
            />
            <text x={left - 8} y={top + plotH * (1 - f) + 3} textAnchor="end" className="ai-dash-chart-axis">
              {Math.round(maxTokens * f).toLocaleString('vi-VN')}
            </text>
            <text x={width - right + 8} y={top + plotH * (1 - f) + 3} className="ai-dash-chart-axis">
              {maxCost > 0 ? `$${(maxCost * f).toFixed(4)}` : f === 0 ? '$0' : ''}
            </text>
          </g>
        ))}
        {points.map((p, i) => (
          <g key={p.bucket_start}>
            <rect
              x={x(i) - bar / 2}
              y={yTokens(num(p.total_tokens))}
              width={bar}
              height={top + plotH - yTokens(num(p.total_tokens))}
              rx={3}
              className="ai-dash-chart-bar"
            >
              <title>{`${bucketLabel(p.bucket_start, bucket)}: ${tokens(p.total_tokens)} token · ${usd(p.cost_usd)} · ${num(p.questions)} câu hỏi`}</title>
            </rect>
            {i % labelEvery === 0 && (
              <text x={x(i)} y={height - 12} textAnchor="middle" className="ai-dash-chart-axis">
                {bucketLabel(p.bucket_start, bucket)}
              </text>
            )}
          </g>
        ))}
        {maxCost > 0 && <path d={line} className="ai-dash-chart-line" />}
        {maxCost > 0 &&
          points.map((p, i) => (
            <circle key={p.bucket_start} cx={x(i)} cy={yCost(num(p.cost_usd))} r={3} className="ai-dash-chart-dot">
              <title>{`${bucketLabel(p.bucket_start, bucket)}: ${usd(p.cost_usd)}`}</title>
            </circle>
          ))}
      </svg>
      <p className="ai-dash-chart-legend">
        <span className="ai-dash-legend-bar" />
        Token (trục trái)
        <span className="ai-dash-legend-line" />
        Chi phí USD (trục phải)
      </p>
      <div className="profile-sr-only">
        <table>
          <caption>Số liệu biểu đồ</caption>
          <thead>
            <tr>
              <th>Kỳ</th>
              <th>Câu hỏi</th>
              <th>Token</th>
              <th>Chi phí</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.bucket_start}>
                <td>{bucketLabel(p.bucket_start, bucket)}</td>
                <td>{num(p.questions)}</td>
                <td>{tokens(p.total_tokens)}</td>
                <td>{usd(p.cost_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AiDashboard() {
  const [overview, setOverview] = useState<Period[] | null>(null);
  const [bucket, setBucket] = useState<Bucket>('day');
  const [series, setSeries] = useState<Point[] | null>(null);
  const [kinds, setKinds] = useState<KindRow[] | null>(null);
  const [models, setModels] = useState<ModelRow[] | null>(null);
  const [turns, setTurns] = useState<Turn[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [calls, setCalls] = useState<Record<string, Call[]>>({});
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  const range = useMemo(() => {
    const config = buckets.find((b) => b.key === bucket)!;
    const now = new Date(),
      start = shift(bucketStart(now, bucket), bucket, -(config.count - 1));
    return {
      from: start.toISOString(),
      to: new Date(now.getTime() + 1000).toISOString(),
      count: config.count,
      start,
      reload,
    };
  }, [bucket, reload]);
  const fail = (e: unknown) => {
    if (!(e instanceof Error) || e.name !== 'AbortError')
      setError(e instanceof Error ? e.message : 'Không thể tải dữ liệu.');
  };

  useEffect(() => {
    const controller = new AbortController();
    catalogRequest<{ items: Period[] }>('/api/admin/ai-dashboard/overview', { signal: controller.signal })
      .then((r) => setOverview(r.items))
      .catch(fail);
    return () => controller.abort();
  }, [range]);

  useEffect(() => {
    const controller = new AbortController(),
      signal = controller.signal,
      params = `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
    catalogRequest<{ items: Point[] }>(`/api/admin/ai-dashboard/series?bucket=${bucket}&${params}`, { signal })
      .then((r) => {
        // Fill empty buckets so the time axis stays continuous.
        const byStart = new Map(r.items.map((p) => [bucketStart(new Date(p.bucket_start), bucket).toISOString(), p]));
        setSeries(
          Array.from({ length: range.count }, (_, i) => {
            const at = shift(range.start, bucket, i).toISOString();
            return byStart.get(at) ?? { bucket_start: at, questions: 0, calls: 0, total_tokens: 0, cost_usd: 0 };
          }),
        );
      })
      .catch(fail);
    catalogRequest<{ items: KindRow[] }>(`/api/admin/ai-dashboard/kinds?${params}`, { signal })
      .then((r) => setKinds(r.items))
      .catch(fail);
    catalogRequest<{ items: ModelRow[] }>(`/api/admin/ai-dashboard/models?${params}`, { signal })
      .then((r) => setModels(r.items))
      .catch(fail);
    return () => controller.abort();
  }, [bucket, range]);

  useEffect(() => {
    const controller = new AbortController();
    catalogRequest<{ items: Turn[]; total: number }>(
      `/api/admin/ai-dashboard/turns?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&page=${page}&q=${encodeURIComponent(query)}`,
      { signal: controller.signal },
    )
      .then((r) => {
        setTurns(r.items);
        setTotal(num(r.total));
      })
      .catch(fail);
    return () => controller.abort();
  }, [range, page, query]);

  async function toggle(turnId: string) {
    if (open === turnId) {
      setOpen(null);
      return;
    }
    setOpen(turnId);
    if (calls[turnId]) return;
    try {
      const r = await catalogRequest<{ items: Call[] }>(`/api/admin/ai-dashboard/turns/${turnId}`);
      setCalls((current) => ({ ...current, [turnId]: r.items }));
    } catch (e) {
      fail(e);
    }
  }
  function changeBucket(next: Bucket) {
    setBucket(next);
    setSeries(null);
    setKinds(null);
    setModels(null);
    setTurns(null);
    setPage(1);
    setOpen(null);
  }
  function refresh() {
    setError('');
    setCalls({});
    setOverview(null);
    setSeries(null);
    setKinds(null);
    setModels(null);
    setTurns(null);
    setReload((v) => v + 1);
  }

  const periodRows = (render: (row: Period) => string) =>
    periods.map((p) => {
      const row = overview?.find((o) => o.period === p.key);
      return (
        <li key={p.key}>
          <span>{p.label}</span>
          <b>{row ? render(row) : '…'}</b>
        </li>
      );
    });
  const config = buckets.find((b) => b.key === bucket)!,
    pages = Math.max(1, Math.ceil(total / 25));
  const startedAt = overview?.find((row) => row.log_started_at)?.log_started_at;

  return (
    <AdminWorkspaceShell section="ai">
      <div className="catalog-title">
        <div>
          <span className="eyebrow">TERAVA AI</span>
          <h1>AI Platform Dashboard</h1>
          <p>Token, chi phí và tốc độ của mọi lần gọi mô hình AI, theo từng câu hỏi của khách hàng.</p>
          <p className="ai-dash-note">
            Số liệu lấy từ log của backend TERAVA, bắt đầu từ {logDate(startedAt)}. Chỉ cộng các model OpenAI vào tổng
            token/chi phí; model chạy cục bộ (Qwen, bge-m3) hiển thị riêng. Không gồm script chạy riêng (rag-eval,
            kb-reindex) và công cụ khác dùng chung API key — đối chiếu trang Usage của OpenAI. Chi phí là ước tính theo
            giá niêm yết, chưa trừ giảm giá prompt caching.
          </p>
        </div>
        <button type="button" className="button secondary" onClick={refresh}>
          <RefreshCw size={15} aria-hidden="true" />
          Làm mới
        </button>
      </div>
      {error && (
        <p role="alert" className="form-alert error">
          {error}
        </p>
      )}

      <section className="catalog-stats ai-dash-stats" aria-label="Tổng quan sử dụng AI">
        <article>
          <div>
            Token đã dùng
            <span className="catalog-stat-icon">
              <Activity size={16} />
            </span>
          </div>
          <ul>
            {periods.map((p) => {
              const row = overview?.find((o) => o.period === p.key);
              return (
                <li key={p.key}>
                  <span>{p.label}</span>
                  <div className="ai-dash-stat-values">
                    <b>{row ? tokens(row.total_tokens) : '…'}</b>
                    {row && <small>+ {tokens(row.local_tokens)} token model cục bộ (miễn phí, không tính)</small>}
                  </div>
                </li>
              );
            })}
          </ul>
        </article>
        <article>
          <div>
            Chi phí (USD)
            <span className="catalog-stat-icon">
              <Coins size={16} />
            </span>
          </div>
          <ul>{periodRows((r) => usd(r.cost_usd))}</ul>
          <small>
            Quy đổi tham khảo {USD_VND.toLocaleString('vi-VN')} đ/USD · tháng này{' '}
            {overview ? vnd(overview.find((o) => o.period === 'month')?.cost_usd) : '…'}
          </small>
        </article>
        <article>
          <div>
            Câu hỏi · lần gọi AI
            <span className="catalog-stat-icon">
              <MessageSquare size={16} />
            </span>
          </div>
          <ul>
            {periods.map((p) => {
              const row = overview?.find((o) => o.period === p.key);
              return (
                <li key={p.key}>
                  <span>{p.label}</span>
                  <div className="ai-dash-stat-values">
                    <b>{row ? `${num(row.questions)} · ${num(row.calls)}` : '…'}</b>
                    {row && <small>+ {tokens(row.local_calls)} lần gọi model cục bộ (miễn phí, không tính)</small>}
                  </div>
                </li>
              );
            })}
          </ul>
        </article>
        <article>
          <div>
            Độ trễ TB / p95 mỗi câu hỏi
            <span className="catalog-stat-icon">
              <Gauge size={16} />
            </span>
          </div>
          <ul>{periodRows((r) => `${ms(r.avg_turn_latency_ms)} / ${ms(r.p95_turn_latency_ms)}`)}</ul>
          <small>
            Tỷ lệ lỗi/dự phòng tháng này:{' '}
            {overview ? percent(overview.find((o) => o.period === 'month')?.error_fallback_rate) : '…'}
          </small>
        </article>
      </section>

      <section className="catalog-list-panel ai-dash-panel" aria-labelledby="ai-usage-chart">
        <div className="ai-dash-head">
          <h2 id="ai-usage-chart">Lượng sử dụng</h2>
          <div className="ai-dash-segmented" role="group" aria-label="Xem theo">
            {buckets.map((b) => (
              <button
                key={b.key}
                type="button"
                aria-pressed={bucket === b.key}
                className={bucket === b.key ? 'active' : ''}
                onClick={() => changeBucket(b.key)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        {!series ? (
          <p className="ai-dash-empty">Đang tải…</p>
        ) : series.every((p) => !num(p.calls)) ? (
          <p className="ai-dash-empty">
            Chưa có dữ liệu sử dụng AI trong {config.count} {config.label.toLowerCase()} gần nhất.
          </p>
        ) : (
          <UsageChart points={series} bucket={bucket} />
        )}
      </section>

      <section className="catalog-list-panel ai-dash-panel" aria-labelledby="ai-by-model">
        <div className="ai-dash-head">
          <h2 id="ai-by-model">Theo model</h2>
          <p>
            {config.count} {config.label.toLowerCase()} gần nhất
          </p>
        </div>
        <div className="catalog-table-scroll">
          <table className="ai-dash-models">
            <thead>
              <tr>
                <th>Model</th>
                <th>Nhà cung cấp</th>
                <th>Số lần</th>
                <th>Token vào</th>
                <th>Token ra</th>
                <th>Chi phí</th>
                <th>Độ trễ TB</th>
              </tr>
            </thead>
            <tbody>
              {!models ? (
                <tr>
                  <td colSpan={7}>Đang tải…</td>
                </tr>
              ) : !models.length ? (
                <tr>
                  <td colSpan={7}>Chưa có dữ liệu sử dụng AI.</td>
                </tr>
              ) : (
                models.map((model) => (
                  <tr key={`${model.provider}-${model.model}`} className={model.model === 'Tổng OpenAI' ? 'total' : ''}>
                    <td>{model.model}</td>
                    <td>{model.provider}</td>
                    <td>{tokens(model.calls)}</td>
                    <td>{tokens(model.input_tokens)}</td>
                    <td>{tokens(model.output_tokens)}</td>
                    <td>{usd(model.cost_usd)}</td>
                    <td>{ms(model.avg_latency_ms)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="catalog-list-panel ai-dash-panel" aria-labelledby="ai-by-kind">
        <div className="ai-dash-head">
          <h2 id="ai-by-kind">Theo loại gọi</h2>
          <p>
            {config.count} {config.label.toLowerCase()} gần nhất
          </p>
        </div>
        <div className="catalog-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Loại gọi</th>
                <th>Mô hình</th>
                <th>Số lần</th>
                <th>Token</th>
                <th>Chi phí</th>
                <th>TB / p95</th>
                <th>Lỗi</th>
              </tr>
            </thead>
            <tbody>
              {!kinds ? (
                <tr>
                  <td colSpan={7}>Đang tải…</td>
                </tr>
              ) : !kinds.length ? (
                <tr>
                  <td colSpan={7}>Chưa có dữ liệu sử dụng AI.</td>
                </tr>
              ) : (
                kinds.map((k) => (
                  <tr key={`${k.kind}-${k.model}`}>
                    <td>{kindLabels[k.kind] ?? k.kind}</td>
                    <td>{k.model}</td>
                    <td>{tokens(k.calls)}</td>
                    <td>{tokens(k.total_tokens)}</td>
                    <td>{usd(k.cost_usd)}</td>
                    <td>
                      {ms(k.avg_latency_ms)} / {ms(k.p95_latency_ms)}
                    </td>
                    <td>{percent(k.error_rate)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="catalog-list-panel ai-dash-panel" aria-labelledby="ai-dash-turns">
        <div className="ai-dash-head">
          <h2 id="ai-dash-turns">Từng câu hỏi</h2>
          <form
            className="ai-dash-search"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setOpen(null);
              setTurns(null);
              setQuery(search.trim());
            }}
          >
            <label className="profile-sr-only" htmlFor="ai-turn-search">
              Tìm câu hỏi
            </label>
            <input
              id="ai-turn-search"
              type="search"
              value={search}
              maxLength={120}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo nội dung câu hỏi…"
            />
            <button className="button secondary" type="submit">
              Tìm
            </button>
          </form>
        </div>
        <div className="catalog-table-scroll">
          <table className="ai-dash-turns">
            <thead>
              <tr>
                <th>
                  <span className="profile-sr-only">Chi tiết</span>
                </th>
                <th>Thời gian</th>
                <th>Câu hỏi</th>
                <th>Lần gọi</th>
                <th>Công cụ</th>
                <th>Prompt</th>
                <th>Token</th>
                <th>Chi phí</th>
                <th>Độ trễ</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {!turns ? (
                <tr>
                  <td colSpan={10}>Đang tải…</td>
                </tr>
              ) : !turns.length ? (
                <tr>
                  <td colSpan={10}>Chưa có câu hỏi nào trong khoảng này.</td>
                </tr>
              ) : (
                turns.map((t) => (
                  <Fragment key={t.turn_id}>
                    <tr className={open === t.turn_id ? 'open' : ''}>
                      <td>
                        <button
                          type="button"
                          className="ai-dash-expand"
                          aria-expanded={open === t.turn_id}
                          aria-label="Xem từng lần gọi AI của câu hỏi này"
                          onClick={() => toggle(t.turn_id)}
                        >
                          {open === t.turn_id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </button>
                      </td>
                      <td>
                        {new Date(t.started_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="ai-dash-question">{t.question_preview || '—'}</td>
                      <td>{num(t.calls)}</td>
                      <td>{t.tools.length ? t.tools.join(', ') : '—'}</td>
                      <td>{t.prompt_versions.length ? t.prompt_versions.join(', ') : '—'}</td>
                      <td>{tokens(t.total_tokens)}</td>
                      <td>
                        {usd(t.cost_usd)}
                        <small>{vnd(t.cost_usd)}</small>
                      </td>
                      <td>{ms(t.turn_latency_ms)}</td>
                      <td>
                        <span className={`ai-dash-status ai-dash-status-${t.worst_status}`}>
                          {statusLabels[t.worst_status] ?? t.worst_status}
                        </span>
                      </td>
                    </tr>
                    {open === t.turn_id && (
                      <tr className="ai-dash-calls">
                        <td colSpan={10}>
                          {!calls[t.turn_id] ? (
                            'Đang tải…'
                          ) : (
                            <table>
                              <thead>
                                <tr>
                                  <th>Bước</th>
                                  <th>Mô hình</th>
                                  <th>Prompt</th>
                                  <th>Công cụ</th>
                                  <th>Token vào / ra</th>
                                  <th>Chi phí</th>
                                  <th>Độ trễ</th>
                                  <th>Trạng thái</th>
                                </tr>
                              </thead>
                              <tbody>
                                {calls[t.turn_id].map((c) => (
                                  <tr key={c.id}>
                                    <td>{kindLabels[c.kind] ?? c.kind}</td>
                                    <td>{c.model}</td>
                                    <td>{c.prompt_version || '—'}</td>
                                    <td>{c.tools_called.length ? c.tools_called.join(', ') : '—'}</td>
                                    <td>
                                      {tokens(c.prompt_tokens)} / {tokens(c.completion_tokens)}
                                    </td>
                                    <td>{usd(c.estimated_cost_usd)}</td>
                                    <td>{ms(c.latency_ms)}</td>
                                    <td>
                                      <span className={`ai-dash-status ai-dash-status-${c.status}`}>
                                        {statusLabels[c.status] ?? c.status}
                                      </span>
                                      {c.error_code && <small>{c.error_code}</small>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="ai-dash-pager">
          <span>
            {total.toLocaleString('vi-VN')} câu hỏi · trang {page}/{pages}
          </span>
          <button
            type="button"
            className="button secondary"
            disabled={page <= 1}
            onClick={() => {
              setTurns(null);
              setPage((p) => p - 1);
            }}
          >
            Trước
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={page >= pages}
            onClick={() => {
              setTurns(null);
              setPage((p) => p + 1);
            }}
          >
            Sau
          </button>
        </div>
      </section>
    </AdminWorkspaceShell>
  );
}
