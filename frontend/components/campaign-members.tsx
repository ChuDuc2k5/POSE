'use client';
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { catalogRequest } from '@/lib/catalog-client';
import { reasonLabels, statusLabels } from '@/lib/campaign-types';

type Member = {
  id: string;
  lead: string;
  phone: string;
  status: string;
  reason: string | null;
  attempts: number;
  last_call: string | null;
  last_outcome: string | null;
  cost: number;
  match_score: number | null;
};
type Buckets = { waiting: number; calling: number; finished: number };
const memberStatuses = [
  'PENDING',
  'QUEUED',
  'IN_PROGRESS',
  'RETRYING',
  'COMPLETED',
  'SKIPPED',
  'OPTED_OUT',
  'EXHAUSTED',
  'FAILED',
  'CANCELLED',
];

/** FR-M07-05 progress: waiting / calling / finished buckets, filtered member list, removal and CSV report. */
export function CampaignMembers({
  id,
  buckets,
  rev,
  onChanged,
}: {
  id: string;
  buckets?: Buckets;
  rev: number;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState(''),
    [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Member[]; total: number } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    catalogRequest<{ item: { items: Member[]; total: number } }>(
      `/api/admin/campaigns/${id}/members?page=${page}${status ? `&status=${status}` : ''}`,
      { signal: controller.signal },
    )
      .then((r) => {
        setData(r.item);
        setError('');
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [id, status, page, rev]);
  async function remove(member: Member) {
    if (!confirm(`Gỡ ${member.lead || 'khách hàng'} khỏi chiến dịch? Khách sẽ không được gọi trong chiến dịch này.`))
      return;
    setBusy(member.id);
    try {
      const response = await fetch(`/api/admin/campaigns/${id}/members/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membership_id: member.id }),
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.message || 'Không thể gỡ khách hàng.');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể gỡ khách hàng.');
    } finally {
      setBusy('');
    }
  }
  const pages = Math.max(1, Math.ceil((data?.total || 0) / 20));
  return (
    <section className="campaigns-members-panel" aria-labelledby="campaign-members-title">
      <div className="campaigns-row">
        <h2 id="campaign-members-title">Đối tượng theo trạng thái</h2>
        <a className="button secondary" href={`/api/admin/campaigns/${id}/report?format=csv`} download>
          <Download size={15} aria-hidden="true" />
          Xuất báo cáo (CSV)
        </a>
      </div>
      <div className="campaigns-progress-buckets">
        {(
          [
            ['Chờ gọi', buckets?.waiting],
            ['Đang gọi', buckets?.calling],
            ['Đã kết thúc', buckets?.finished],
          ] as const
        ).map(([label, n]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{n == null ? '…' : Number(n).toLocaleString('vi-VN')}</strong>
          </article>
        ))}
      </div>
      <label className="catalog-field campaigns-member-filter">
        Lọc trạng thái
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Tất cả</option>
          {memberStatuses.map((s) => (
            <option key={s} value={s}>
              {statusLabels[s] || s}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="form-alert error">
          {error}
        </p>
      )}
      <div className="catalog-table-scroll">
        <table className="campaigns-members">
          <thead>
            <tr>
              <th>Khách hàng</th>
              <th>Số điện thoại</th>
              <th>Trạng thái</th>
              <th>Lý do</th>
              <th>Lần thử</th>
              <th>Cuộc gọi gần nhất</th>
              <th>Chi phí (VND)</th>
              <th>
                <span className="profile-sr-only">Thao tác</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {!data ? (
              <tr>
                <td colSpan={8}>Đang tải…</td>
              </tr>
            ) : !data.items.length ? (
              <tr>
                <td colSpan={8}>Không có khách hàng ở trạng thái này.</td>
              </tr>
            ) : (
              data.items.map((m) => (
                <tr key={m.id}>
                  <td>{m.lead || '—'}</td>
                  <td>{m.phone}</td>
                  <td>{statusLabels[m.status] || m.status}</td>
                  <td>{m.reason ? reasonLabels[m.reason] || m.reason : '—'}</td>
                  <td>{m.attempts ?? 0}</td>
                  <td>
                    {m.last_call
                      ? `${statusLabels[m.last_call] || m.last_call}${m.last_outcome ? ` · ${m.last_outcome}` : ''}`
                      : '—'}
                  </td>
                  <td>{Number(m.cost || 0).toLocaleString('vi-VN')}</td>
                  <td>
                    {m.status === 'PENDING' && (
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy === m.id}
                        onClick={() => remove(m)}
                      >
                        Gỡ khỏi chiến dịch
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="campaigns-row">
        <span>
          {(data?.total || 0).toLocaleString('vi-VN')} khách hàng · trang {page}/{pages}
        </span>
        <span>
          <button type="button" className="button secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Trước
          </button>{' '}
          <button
            type="button"
            className="button secondary"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Sau
          </button>
        </span>
      </div>
    </section>
  );
}

type Version = {
  config_version: number;
  reason: string;
  actor_id: string;
  created_at: string;
  snapshot: Record<string, unknown>;
};
type Event = { id: string; action: string; reason: string; actor_id: string | null; created_at: string };
const eventLabels: Record<string, string> = {
  schedule: 'Lên lịch',
  start: 'Bắt đầu',
  pause: 'Tạm dừng',
  resume: 'Tiếp tục',
  cancel: 'Hủy',
  completed: 'Hoàn tất',
  budget_alert: 'Tạm dừng do hết ngân sách',
  provider_pause: 'Tạm dừng do lỗi nhà cung cấp',
  member_removed: 'Gỡ khách hàng',
  audience: 'Cập nhật đối tượng',
  config: 'Cập nhật cấu hình',
};
const time = (iso: string) => new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'medium' });

/** Audit trail: running-config versions and lifecycle events. */
export function CampaignHistory({ id, rev }: { id: string; rev: number }) {
  const [data, setData] = useState<{ versions: Version[]; events: Event[] } | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    catalogRequest<{ versions: Version[]; events: Event[] }>(`/api/admin/campaigns/${id}/history`, {
      signal: controller.signal,
    })
      .then((r) => {
        setData(r);
        setError('');
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [id, rev]);
  if (error)
    return (
      <p role="alert" className="form-alert error">
        {error}
      </p>
    );
  if (!data) return <p role="status">Đang tải lịch sử…</p>;
  return (
    <>
      <h2>Phiên bản cấu hình</h2>
      <p>
        Mỗi lần sửa cấu hình khi chiến dịch đang chạy tạo một phiên bản mới; cuộc gọi đã thực hiện giữ phiên bản cũ.
      </p>
      <div className="catalog-table-scroll">
        <table className="campaigns-members">
          <thead>
            <tr>
              <th>Phiên bản</th>
              <th>Thời gian</th>
              <th>Lý do</th>
              <th>Ngân sách (VND)</th>
              <th>Hạn mức/ngày</th>
            </tr>
          </thead>
          <tbody>
            {!data.versions.length ? (
              <tr>
                <td colSpan={5}>Chưa có phiên bản cấu hình nào.</td>
              </tr>
            ) : (
              data.versions.map((v) => (
                <tr key={v.config_version}>
                  <td>{v.config_version}</td>
                  <td>{time(v.created_at)}</td>
                  <td>{v.reason || '—'}</td>
                  <td>
                    {v.snapshot?.budget_limit_vnd == null
                      ? '—'
                      : Number(v.snapshot.budget_limit_vnd).toLocaleString('vi-VN')}
                  </td>
                  <td>{String(v.snapshot?.daily_call_limit ?? '—')}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <h2>Sự kiện</h2>
      <div className="catalog-table-scroll">
        <table className="campaigns-members">
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Sự kiện</th>
              <th>Lý do</th>
            </tr>
          </thead>
          <tbody>
            {!data.events.length ? (
              <tr>
                <td colSpan={3}>Chưa có sự kiện nào.</td>
              </tr>
            ) : (
              data.events.map((e) => (
                <tr key={e.id}>
                  <td>{time(e.created_at)}</td>
                  <td>{eventLabels[e.action] || e.action}</td>
                  <td>{e.reason ? reasonLabels[e.reason] || e.reason : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
