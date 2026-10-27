'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AdminWorkspaceShell } from './admin-workspace-shell';
import { catalogRequest } from '@/lib/catalog-client';
import { statusLabels, type Campaign } from '@/lib/campaign-types';
import { CampaignDetail } from './campaign-detail';
export function CampaignWorkspace({ id }: { id?: string }) {
  const router = useRouter();
  const [items, setItems] = useState<Campaign[]>([]),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [error, setError] = useState(''),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (id) return;
    const controller = new AbortController();
    catalogRequest<{ items: Campaign[]; total: number }>(
      `/api/admin/campaigns?search=${encodeURIComponent(search)}&page=${page}`,
      { signal: controller.signal },
    )
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
        setError('');
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [id, search, page]);
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await catalogRequest<{ item: Campaign }>('/api/admin/campaigns', {
        method: 'POST',
        body: JSON.stringify({ name, version: 0 }),
      });
      router.push(`/admin/campaigns/${r.item.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể tạo chiến dịch.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdminWorkspaceShell section="campaigns">
      {id ? (
        <CampaignDetail id={id} />
      ) : (
        <>
          <div className="catalog-title">
            <div>
              <span className="eyebrow">TERAVA GROUP</span>
              <h1>Chiến dịch gọi</h1>
              <p>Cấu hình đối tượng, kịch bản và lịch liên hệ.</p>
            </div>
          </div>
          <section className="catalog-list-panel campaigns-panel">
            <form onSubmit={create} className="campaigns-row">
              <label className="catalog-field">
                Tên chiến dịch mới
                <input
                  required
                  minLength={2}
                  maxLength={160}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ví dụ: Tư vấn căn hộ tháng 10"
                />
              </label>
              <button className="button primary" disabled={busy}>
                Tạo bản nháp
              </button>
            </form>
            <label className="catalog-field">
              Tìm chiến dịch
              <input
                type="search"
                value={search}
                maxLength={160}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Tìm theo tên…"
              />
            </label>
            {error && (
              <p role="alert" className="form-alert error">
                {error}
              </p>
            )}
            <div className="campaigns-list">
              {items.map((c) => (
                <Link key={c.id} href={`/admin/campaigns/${c.id}`} className="campaigns-list-item">
                  <div>
                    <strong>{c.name}</strong>
                    <p>
                      {c.objective || 'Chưa có mục tiêu'} · Phiên bản {c.version}
                    </p>
                  </div>
                  <span className={`campaigns-status status-${c.status}`}>{statusLabels[c.status] || c.status}</span>
                </Link>
              ))}
              {!items.length && <p>Chưa có chiến dịch phù hợp.</p>}
            </div>
            <footer className="campaigns-row">
              <span>
                {total} chiến dịch · Trang {page}
              </span>
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Trước
              </button>
              <button disabled={page * 20 >= total} onClick={() => setPage((p) => p + 1)}>
                Sau
              </button>
            </footer>
          </section>
        </>
      )}
    </AdminWorkspaceShell>
  );
}
