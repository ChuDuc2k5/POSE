'use client';
import { useState } from 'react';
import { catalogRequest } from '@/lib/catalog-client';

type Preview = {
  total?: number;
  eligible?: number;
  matched?: number;
  excluded?: Record<string, number>;
  sample?: Array<{ id: string; full_name: string; match_score?: number; score?: number; reasons?: string[] }>;
};
const reasonLabels: Record<string, string> = {
  BUDGET: 'Ngân sách',
  AREA: 'Diện tích',
  PROPERTY_TYPE: 'Loại hình',
  LOCATION: 'Khu vực',
  DIRECT_INTEREST: 'Quan tâm trực tiếp',
  RECENCY: 'Tương tác gần đây',
  TRANSACTION_MISMATCH: 'Sai nhu cầu giao dịch',
  NO_MATCH: 'Chưa đủ điểm',
};

export function CampaignAudienceMatch({ id, onApplied }: { id: string; onApplied?: () => void }) {
  const [enabled, setEnabled] = useState(false),
    [minMatch, setMinMatch] = useState(40),
    [filters, setFilters] = useState<Record<string, unknown>>({ match_campaign_products: false, min_match: 40 }),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const set = (key: string, value: unknown) => setFilters((f) => ({ ...f, [key]: value }));
  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      const c = await catalogRequest<{ item: { version: number } }>(`/api/admin/campaigns/${id}`);
      const r = await fetch(`/api/admin/campaigns/${id}/audience`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: c.item.version,
          reason: 'Áp dụng bộ lọc TERAVA MATCH',
          filter: { ...filters, match_campaign_products: enabled, min_match: minMatch },
        }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.message || 'Không thể lưu bộ lọc.');
      setSaved(true);
      onApplied?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save filter.');
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`/api/admin/campaigns/${id}/audience-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter: { ...filters, match_campaign_products: enabled, min_match: minMatch } }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.message || 'Không thể xem trước đối tượng.');
      setPreview(data.item || data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể xem trước đối tượng.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="campaigns-audience-match-panel" aria-label="Gợi ý theo sản phẩm chiến dịch">
      <div className="campaigns-match-heading">
        <div>
          <span className="eyebrow">TERAVA MATCH</span>
          <h3>Gợi ý theo sản phẩm chiến dịch</h3>
          <p>
            Chấm điểm theo sản phẩm, nhu cầu đã xác nhận và tín hiệu tương tác; kết quả được ghi lại khi lưu đối tượng.
          </p>
        </div>
        <button className="button secondary" type="button" aria-pressed={enabled} onClick={() => setEnabled((v) => !v)}>
          {enabled ? 'Đang bật' : 'Bật gợi ý'}
        </button>
      </div>
      <div className="catalog-form-grid campaigns-match-filters">
        <label className="catalog-field">
          Điểm khớp tối thiểu
          <input
            type="number"
            min="0"
            max="85"
            value={minMatch}
            onChange={(e) => {
              const n = Math.max(0, Math.min(85, Number(e.target.value) || 0));
              setMinMatch(n);
              set('min_match', n);
            }}
          />
          <small>Điểm tối đa 85.</small>
        </label>
        <label className="catalog-field">
          Khu vực nhu cầu
          <input
            placeholder="Ví dụ: Thủ Đức"
            value={Array.isArray(filters.needs_location) ? filters.needs_location.join(', ') : ''}
            onChange={(e) =>
              set(
                'needs_location',
                e.target.value
                  ? e.target.value
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean)
                  : undefined,
              )
            }
          />
        </label>
        <label className="catalog-field">
          Loại hình nhu cầu
          <input
            placeholder="Căn hộ, nhà phố"
            value={Array.isArray(filters.needs_property_type) ? filters.needs_property_type.join(', ') : ''}
            onChange={(e) =>
              set(
                'needs_property_type',
                e.target.value
                  ? e.target.value
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean)
                  : undefined,
              )
            }
          />
        </label>
        <label className="catalog-field">
          Tiến độ
          <input
            placeholder="30 ngày"
            value={Array.isArray(filters.timeline) ? filters.timeline.join(', ') : ''}
            onChange={(e) =>
              set(
                'timeline',
                e.target.value
                  ? e.target.value
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean)
                  : undefined,
              )
            }
          />
        </label>
        <label className="catalog-field">
          Đã tương tác trong (ngày)
          <input
            type="number"
            min="1"
            value={String(filters.interacted_days || '')}
            onChange={(e) => set('interacted_days', e.target.value ? Number(e.target.value) : undefined)}
          />
        </label>
        <label className="catalog-field">
          Loại cuộc gọi trong (ngày)
          <input
            type="number"
            min="1"
            value={String(filters.exclude_called_days || '')}
            onChange={(e) => set('exclude_called_days', e.target.value ? Number(e.target.value) : undefined)}
          />
        </label>
        <label className="catalog-field">
          <span>Điều kiện bổ sung</span>
          <span>
            <input
              type="checkbox"
              checked={filters.confirmed_needs_only === true}
              onChange={(e) => set('confirmed_needs_only', e.target.checked || undefined)}
            />{' '}
            Chỉ nhu cầu đã xác nhận
          </span>
          <span>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Khớp sản phẩm
            chiến dịch
          </span>
        </label>
      </div>
      <div className="campaigns-row">
        <button className="button primary" type="button" disabled={busy} onClick={run}>
          Xem kết quả khớp
        </button>
        <button className="button secondary" type="button" disabled={busy} onClick={apply}>
          Áp dụng bộ lọc này
        </button>
        {saved && <span role="status">Đã lưu bộ lọc.</span>}
        {error && (
          <span role="alert" className="form-alert error">
            {error}
          </span>
        )}
      </div>
      {preview && (
        <>
          <div className="catalog-stats">
            <article>
              <span>Đủ điều kiện</span>
              <strong>{preview.eligible ?? preview.total ?? 0}</strong>
            </article>
            <article>
              <span>Phù hợp</span>
              <strong>{preview.matched ?? 0}</strong>
            </article>
            <article>
              <span>Bị loại theo lý do</span>
              <strong>{Object.values(preview.excluded || {}).reduce((a, b) => a + b, 0)}</strong>
            </article>
          </div>
          <div className="campaigns-list">
            <table>
              <caption className="sr-only">Mẫu đối tượng khớp</caption>
              <thead>
                <tr>
                  <th>Khách hàng</th>
                  <th>Điểm khớp</th>
                  <th>Lý do</th>
                </tr>
              </thead>
              <tbody>
                {(preview.sample || []).map((s) => (
                  <tr key={s.id}>
                    <td>{s.full_name}</td>
                    <td>{s.match_score ?? s.score ?? 0}</td>
                    <td>
                      <span className="campaigns-reason-chips">
                        {(s.reasons || []).map((r) => (
                          <span key={r}>{reasonLabels[r] || r}</span>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
