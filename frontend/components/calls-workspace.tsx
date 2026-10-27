'use client';
import Link from 'next/link';
import { socket } from '@/lib/socket';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { catalogRequest } from '@/lib/catalog-client';
import {
  activeCallStatuses,
  callLabels,
  callMoney,
  callTime,
  endReasonLabel,
  maskedCallPhone,
  type CallView,
} from '@/lib/calling/presentation';
import { AdminWorkspaceShell } from './admin-workspace-shell';
import { CampaignConfirm } from './campaign-confirm';
import { CallEvidence } from './call-evidence';

type Detail = {
  item: CallView;
  events: { id: string; type: string; provider: string; occurred_at: string }[];
  consents: { id: string; purpose: string; status: string; evidence: string }[];
};
type Campaign = { id: string; name: string };
export function CallsWorkspace({ id, sales = false }: { id?: string; sales?: boolean }) {
  const params = useSearchParams();
  const [items, setItems] = useState<CallView[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [status, setStatus] = useState(params.get('status') || ''),
    [provider, setProvider] = useState(params.get('provider') || ''),
    [campaign, setCampaign] = useState(params.get('campaign_id') || ''),
    [revision, setRevision] = useState(0);
  const [worker, setWorker] = useState<{ redis: boolean; dispatcherEvery: number; lastError: string | null } | null>(
    null,
  );
  const [action, setAction] = useState<{ call: CallView; kind: 'stop' | 'opt-out' } | null>(null),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (sales) return;
    catalogRequest<{ redis: boolean; dispatcherEvery: number; lastError: string | null }>('/api/admin/calls/worker')
      .then(setWorker)
      .catch(() => {});
    const controller = new AbortController();
    catalogRequest<{ items: Campaign[] }>('/api/admin/campaigns?pageSize=50', { signal: controller.signal })
      .then((r) => setCampaigns(r.items))
      .catch(() => {});
    return () => controller.abort();
  }, [sales]);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      const filter = new URLSearchParams();
      if (status) filter.set('status', status);
      if (provider) filter.set('provider', provider);
      if (campaign) filter.set('campaign_id', campaign);
      const request = id
        ? catalogRequest<Detail>(`/api/calls/${id}`, { signal: controller.signal }).then(setDetail)
        : catalogRequest<{ items: CallView[] }>(`/api/calls?${filter}`, { signal: controller.signal }).then((r) =>
            setItems(r.items),
          );
      request
        .then(() => setError(''))
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    };
    refresh();
    socket.on('call.status', refresh);
    socket.connect();
    const timer = setInterval(refresh, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
      socket.off('call.status', refresh);
    };
  }, [id, status, provider, campaign, revision]);
  const campaignName = (call: CallView) =>
    campaigns.find((c) => c.id === call.campaign_id)?.name ||
    (call.campaign_id ? 'Chiến dịch gọi tự động' : 'Gọi thử độc lập');
  const phone = (call: CallView) =>
    id && !sales && call.phone_e164 ? call.phone_e164 : maskedCallPhone(call.phone_e164);
  const detailHref = (call: CallView) => `${sales ? '/sales/calls' : '/admin/calls'}/${call.id}`;
  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!action) return;
    setBusy(true);
    try {
      await catalogRequest(action.kind === 'stop' ? `/api/calls/${action.call.id}/stop` : '/api/contacts/opt-out', {
        method: 'POST',
        body: JSON.stringify({ reason, phone: action.call.phone_e164 }),
      });
      setAction(null);
      setReason('');
      setRevision((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const buttons = (call: CallView) => (
    <div className="calls-actions">
      {activeCallStatuses.includes(call.status) && (
        <button
          className="button secondary"
          onClick={() => {
            setReason('');
            setAction({ call, kind: 'stop' });
          }}
        >
          Dừng cuộc gọi
        </button>
      )}
      {call.phone_e164 && (
        <button
          className="button secondary"
          onClick={() => {
            setReason('');
            setAction({ call, kind: 'opt-out' });
          }}
        >
          Không liên hệ
        </button>
      )}
    </div>
  );
  const badge = (call: CallView) => (
    <span className="calls-pill">{call.provider === 'simulator' ? 'Giả lập' : call.provider}</span>
  );
  const title = id ? 'Chi tiết cuộc gọi' : sales ? 'Cuộc gọi của khách được giao' : 'Cuộc gọi';
  const content = (
    <>
      <div className="catalog-title">
        <div>
          <span className="eyebrow">{sales ? 'KHÁCH HÀNG ĐƯỢC GIAO' : 'TERAVA GROUP'}</span>
          {sales ? <h2>{title}</h2> : <h1>{title}</h1>}
          <p>Theo dõi kết nối, bằng chứng đồng ý và chi phí.</p>
        </div>
        {!sales && !id && (
          <Link className="button primary" href="/admin/calls/playground">
            Mô phỏng hội thoại
          </Link>
        )}
      </div>
      {!sales && !id && worker && (
        <p role="status">
          Hàng đợi gọi: {worker.redis ? 'Redis đang chạy' : 'Điều phối thủ công'} · mỗi {worker.dispatcherEvery / 1000}{' '}
          giây{worker.lastError ? ` · ${worker.lastError}` : ''}
        </p>
      )}
      {error && (
        <p role="alert" className="form-alert error">
          {error}
        </p>
      )}
      {loading && <p role="status">Đang tải cuộc gọi…</p>}
      {id ? (
        detail && (
          <section className="catalog-list-panel campaigns-panel calls-detail">
            <header className="calls-detail-heading">
              <h2>{phone(detail.item)}</h2>
              <span className="calls-pill" data-call-status>
                {callLabels[detail.item.status] || detail.item.status}
              </span>
              {badge(detail.item)}
            </header>
            <p>
              {campaignName(detail.item)} · Bắt đầu: {callTime(detail.item.started_at)} · Thời lượng:{' '}
              {detail.item.duration_seconds === null ? 'Chưa kết thúc' : `${detail.item.duration_seconds} giây`}
            </p>
            <p>Lý do kết thúc: {endReasonLabel(detail.item.end_reason)}</p>
            {buttons(detail.item)}
            <section className="calls-cost" data-call-cost>
              <h3>Chi phí</h3>
              <dl>
                <div>
                  <dt>Ước lượng</dt>
                  <dd>{callMoney(detail.item.cost_estimated_vnd)}</dd>
                </div>
                <div>
                  <dt>Thực tế</dt>
                  <dd>{callMoney(detail.item.cost_actual, detail.item.cost_currency || 'VND')}</dd>
                </div>
                {detail.item.fx_rate !== null && (
                  <div>
                    <dt>Tỷ giá</dt>
                    <dd>{Number(detail.item.fx_rate).toLocaleString('vi-VN')}</dd>
                  </div>
                )}
                {detail.item.fx_source && (
                  <div>
                    <dt>Nguồn tỷ giá</dt>
                    <dd>{detail.item.fx_source}</dd>
                  </div>
                )}
              </dl>
              {detail.item.cost_unknown && <p>Chi phí chưa đối soát; đang dùng dự phòng.</p>}
            </section>
            <CallEvidence
              id={id}
              recordingStatus={detail.item.recording_status}
              transcriptStatus={detail.item.transcript_status}
            />
            <section>
              <h3>Bằng chứng đồng ý</h3>
              {detail.consents.length ? (
                detail.consents.map((c) => (
                  <p key={c.id}>
                    {c.purpose} · {c.status}: {c.evidence}
                  </p>
                ))
              ) : (
                <p>Chưa có bằng chứng đồng ý trong cuộc gọi này.</p>
              )}
            </section>
            <section>
              <h3>Dòng thời gian</h3>
              {detail.events.length ? (
                <ol className="calls-timeline">
                  {detail.events.map((event) => (
                    <li key={event.id}>
                      <time dateTime={event.occurred_at}>{callTime(event.occurred_at)}</time>
                      <strong>{callLabels[event.type.toUpperCase()] || event.type}</strong>
                      <span>Nguồn: {event.provider === 'simulator' ? 'Giả lập' : event.provider}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>Chưa có sự kiện được ghi nhận.</p>
              )}
            </section>
          </section>
        )
      ) : (
        <section className="catalog-list-panel campaigns-panel">
          <div className="calls-filters" aria-label="Bộ lọc cuộc gọi">
            <label className="catalog-field">
              Chiến dịch
              {sales ? (
                <input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="Mã chiến dịch" />
              ) : (
                <select value={campaign} onChange={(e) => setCampaign(e.target.value)}>
                  <option value="">Tất cả chiến dịch</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label className="catalog-field">
              Trạng thái
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Tất cả trạng thái</option>
                {Object.entries(callLabels)
                  .filter(([key]) => key === key.toUpperCase())
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="catalog-field">
              Nhà cung cấp
              <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="">Tất cả nhà cung cấp</option>
                <option value="simulator">Giả lập</option>
              </select>
            </label>
          </div>
          <div className="calls-list">
            {items.map((call) => (
              <article className="calls-item" key={call.id} data-call-id={call.id}>
                <div className="calls-item-heading">
                  <Link className="calls-phone" href={detailHref(call)}>
                    {phone(call)}
                  </Link>
                  <div className="calls-actions">
                    <span className="calls-pill" data-call-status>
                      {callLabels[call.status] || call.status}
                    </span>
                    {badge(call)}
                  </div>
                </div>
                <dl className="calls-facts">
                  <div>
                    <dt>Chiến dịch</dt>
                    <dd>{campaignName(call)}</dd>
                  </div>
                  <div>
                    <dt>Bắt đầu</dt>
                    <dd>{callTime(call.started_at)}</dd>
                  </div>
                  <div>
                    <dt>Thời lượng</dt>
                    <dd>{call.duration_seconds === null ? 'Chưa kết thúc' : `${call.duration_seconds} giây`}</dd>
                  </div>
                  <div>
                    <dt>Lý do kết thúc</dt>
                    <dd>{endReasonLabel(call.end_reason)}</dd>
                  </div>
                </dl>
                {sales && (
                  <div className="calls-evidence-links">
                    <p>
                      Ghi âm: {callLabels[call.recording_status]}{' '}
                      {call.recording_status === 'Available' && (
                        <Link href={`${detailHref(call)}#recording`}>Mở bản ghi âm</Link>
                      )}
                    </p>
                    <p>
                      Bản chép lời: {callLabels[call.transcript_status]}{' '}
                      {call.transcript_status === 'Available' && (
                        <Link href={`${detailHref(call)}#transcript`}>Xem bản chép lời</Link>
                      )}
                    </p>
                  </div>
                )}
                <div className="calls-item-footer">
                  <Link href={detailHref(call)}>Xem chi tiết →</Link>
                  {buttons(call)}
                </div>
              </article>
            ))}
            {!loading && !items.length && <p>Chưa có cuộc gọi phù hợp.</p>}
          </div>
        </section>
      )}
      {action && (
        <CampaignConfirm
          label={action.kind === 'stop' ? 'Yêu cầu dừng cuộc gọi' : 'Ghi nhận không liên hệ'}
          onClose={() => setAction(null)}
        >
          <form className="calls-reason-form" onSubmit={run}>
            <h2>{action.kind === 'stop' ? 'Yêu cầu dừng cuộc gọi' : 'Ghi nhận không liên hệ'}</h2>
            <p>{phone(action.call)}</p>
            <label className="catalog-field">
              Lý do
              <textarea
                autoFocus
                required
                minLength={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <div className="calls-actions">
              <button className="button secondary" type="button" onClick={() => setAction(null)}>
                Quay lại
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? 'Đang gửi…' : 'Gửi yêu cầu'}
              </button>
            </div>
          </form>
        </CampaignConfirm>
      )}
    </>
  );
  if (sales)
    return (
      <section className="calls-sales" aria-label="Cuộc gọi của khách được giao">
        {content}
      </section>
    );
  return (
    <AdminWorkspaceShell section="calls" detail={id ? 'Chi tiết cuộc gọi' : undefined}>
      {content}
    </AdminWorkspaceShell>
  );
}
