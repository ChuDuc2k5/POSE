'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  Layers3,
  LoaderCircle,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Pencil,
  Check,
  Trash2,
  RotateCcw,
  History,
} from 'lucide-react';
import { CatalogEditor, type CatalogDetail } from './catalog-editor';
import { CatalogLifecycleDialog } from './catalog-lifecycle-dialog';
import { catalogRequest } from '@/lib/catalog-client';
import { availabilityLabels, priceLabel, publicationLabels, propertyTypeLabels, type CatalogItem } from '@/lib/catalog';

type Kind = 'projects' | 'subdivisions' | 'properties';
type List = { items: CatalogItem[]; total: number; page: number; pageSize: number };
const sections = [
  { kind: 'properties', name: 'Sản phẩm', icon: Building2 },
  { kind: 'projects', name: 'Dự án', icon: FolderKanban },
  { kind: 'subdivisions', name: 'Phân khu', icon: Layers3 },
] as const;
const names: Record<Kind, string> = { projects: 'dự án', subdivisions: 'phân khu', properties: 'sản phẩm' };
async function options(kind: Kind, signal: AbortSignal) {
  const items: CatalogItem[] = [];
  let page = 1;
  while (true) {
    const data = await catalogRequest<List>(`/api/admin/catalog/${kind}?page=${page}&pageSize=50`, { signal });
    items.push(...data.items);
    if (items.length >= data.total || !data.items.length) return items;
    if (++page > 200) throw new Error('Danh mục vượt quá giới hạn tải. Vui lòng liên hệ quản trị hệ thống.');
  }
}
const isKind = (value: string | null): value is Kind =>
  value === 'properties' || value === 'projects' || value === 'subdivisions';
export function CatalogWorkspace() {
  const router = useRouter(),
    requestedKind = useSearchParams().get('kind');
  const [kind, setKind] = useState<Kind>(isKind(requestedKind) ? requestedKind : 'properties');
  const [scope, setScope] = useState<'all' | 'mine'>('all'),
    [trash, setTrash] = useState(false),
    [notice, setNotice] = useState('');
  const [lifecycle, setLifecycle] = useState<{ item: CatalogItem; action: 'delete' | 'restore' } | null>(null);
  const [items, setItems] = useState<CatalogItem[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1);
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState(''),
    [project, setProject] = useState('');
  const [projects, setProjects] = useState<CatalogItem[]>([]),
    [subdivisions, setSubdivisions] = useState<CatalogItem[]>([]);
  const [stats, setStats] = useState({ properties: 0, published: 0 });
  const [optionsError, setOptionsError] = useState('');
  const [loadedKey, setLoadedKey] = useState(''),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [opening, setOpening] = useState('');
  const [editor, setEditor] = useState<{ kind: Kind; detail: CatalogDetail | null } | null>(null);
  const loadKey = JSON.stringify([kind, page, query, status, project, revision, scope, trash]);
  const loading = loadedKey !== loadKey;
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      options('projects', controller.signal),
      options('subdivisions', controller.signal),
      catalogRequest<List>('/api/admin/catalog/properties?pageSize=1', { signal: controller.signal }),
      catalogRequest<List>('/api/admin/catalog/properties?status=Published&pageSize=1', { signal: controller.signal }),
    ])
      .then(([p, s, all, published]) => {
        setProjects(p);
        setSubdivisions(s);
        setStats({ properties: all.total, published: published.total });
        setOptionsError('');
      })
      .catch((cause) => {
        if (cause.name !== 'AbortError') setOptionsError(cause.message || 'Không thể tải danh mục dự án.');
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '20',
      search: query,
      ...(status ? { status } : {}),
      ...(project && kind !== 'projects' ? { project } : {}),
      ...(kind === 'properties' ? { scope, trash: String(trash) } : {}),
    });
    catalogRequest<List>(`/api/admin/catalog/${kind}?${params}`, { signal: controller.signal })
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
        setError('');
        if (page > 1 && !data.items.length) setPage(Math.max(1, Math.ceil(data.total / 20)));
      })
      .catch((cause) => {
        if (cause.name !== 'AbortError') setError(cause.message || 'Không thể tải dữ liệu.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadedKey(loadKey);
      });
    return () => controller.abort();
  }, [kind, page, query, status, project, revision, loadKey, scope, trash]);
  useEffect(() => {
    if (isKind(requestedKind) && requestedKind !== kind) changeKind(requestedKind);
  }, [requestedKind]); // eslint-disable-line react-hooks/exhaustive-deps
  function changeKind(value: Kind) {
    setKind(value);
    if (requestedKind !== value) router.replace(`/admin?kind=${value}`, { scroll: false });
    setStatus('');
    setProject('');
    setPage(1);
    setSearch('');
    setQuery('');
    setScope('all');
    setTrash(false);
    setNotice('');
  }
  async function edit(item: CatalogItem) {
    setOpening(item.id);
    setError('');
    try {
      const detail = await catalogRequest<CatalogDetail>(`/api/admin/catalog/${kind}/${item.id}`);
      setEditor({ kind, detail });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải chi tiết.');
    } finally {
      setOpening('');
    }
  }
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const subdivisionNames = new Map(subdivisions.map((s) => [s.id, s.name]));
  const pages = Math.max(1, Math.ceil(total / 20));
  return (
    <>
      <div className="catalog-title">
        <div>
          <span className="eyebrow">DANH MỤC BẤT ĐỘNG SẢN</span>
          <h1>Quản lý bất động sản</h1>
          <p>Tổ chức danh mục, quản lý sản phẩm và chủ động công bố thông tin.</p>
        </div>
        <button className="button primary" onClick={() => setEditor({ kind, detail: null })}>
          <Plus size={18} /> Thêm {names[kind]}
        </button>
      </div>
      <div className="catalog-stats">
        {[
          { label: 'Tổng dự án', value: projects.length, icon: FolderKanban, detail: 'Cấu trúc danh mục' },
          { label: 'Tổng phân khu', value: subdivisions.length, icon: Layers3, detail: 'Thuộc các dự án' },
          { label: 'Tổng sản phẩm', value: stats.properties, icon: Building2, detail: 'Tất cả trạng thái' },
          { label: 'Đã công bố', value: stats.published, icon: Check, detail: 'Trạng thái Published' },
        ].map(({ label, value, icon: Icon, detail }) => (
          <article key={label}>
            <div>
              <span>{label}</span>
              <span className="catalog-stat-icon">
                <Icon size={19} />
              </span>
            </div>
            <strong>{value.toLocaleString('vi-VN')}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </div>
      <section className="catalog-list-panel" aria-labelledby="catalog-list-title">
        <div className="catalog-list-heading">
          <div>
            <h2 id="catalog-list-title">
              Danh sách {names[kind]}
              <span>{loading ? '…' : total}</span>
            </h2>
            <p>
              {kind === 'properties'
                ? 'Quản lý nội dung, tệp đính kèm và trạng thái sản phẩm.'
                : kind === 'projects'
                  ? 'Quản lý dự án, vị trí và tiện ích.'
                  : 'Tổ chức phân khu trong từng dự án.'}
            </p>
          </div>
          <button
            className="catalog-refresh"
            onClick={() => setRevision((r) => r + 1)}
            disabled={loading}
            aria-label="Tải lại danh mục"
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            <span>Tải lại</span>
          </button>
        </div>
        <div className="catalog-section-tabs" aria-label="Chọn danh mục">
          {sections.map(({ kind: value, name: label, icon: Icon }) => (
            <button key={value} onClick={() => changeKind(value)} aria-pressed={kind === value}>
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
        {kind === 'properties' && (
          <div className="catalog-views" aria-label="Phạm vi sản phẩm">
            {[
              { label: 'Tất cả sản phẩm', scope: 'all', trash: false },
              { label: 'Sản phẩm tôi tạo', scope: 'mine', trash: false },
              { label: 'Thùng rác', scope: 'all', trash: true },
            ].map((view) => (
              <button
                key={view.label}
                aria-pressed={scope === view.scope && trash === view.trash}
                onClick={() => {
                  setScope(view.scope as 'all' | 'mine');
                  setTrash(view.trash);
                  setStatus('');
                  setPage(1);
                  setNotice('');
                }}
              >
                {view.trash && <Trash2 size={14} />} {view.label}
              </button>
            ))}
          </div>
        )}
        {notice && (
          <div className="catalog-action-notice form-alert success" role="status">
            {notice}
          </div>
        )}
        <div className="catalog-toolbar">
          <label className="catalog-search">
            <Search size={18} />
            <span className="profile-sr-only">Tìm theo mã hoặc tên</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={160}
              placeholder={`Tìm mã hoặc tên ${names[kind]}…`}
            />
          </label>
          <div className="catalog-filter">
            <SlidersHorizontal size={16} />
            <label>
              <span className="profile-sr-only">Lọc trạng thái</span>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Tất cả trạng thái</option>
                {kind === 'properties' ? (
                  Object.entries(publicationLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="active">Còn hiệu lực</option>
                    <option value="archived">Lưu trữ</option>
                  </>
                )}
              </select>
            </label>
          </div>
          {kind !== 'projects' && (
            <label className="catalog-project-filter">
              <span className="profile-sr-only">Lọc dự án</span>
              <select
                value={project}
                onChange={(e) => {
                  setProject(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Tất cả dự án</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {(error || optionsError) && (
          <div className="catalog-list-error form-alert error" role="alert">
            {error || optionsError}
            <button onClick={() => setRevision((r) => r + 1)}>Thử lại</button>
          </div>
        )}
        {loading ? (
          <div className="catalog-list-loading">
            <LoaderCircle size={25} className="spin" />
            <p>Đang tải danh mục…</p>
          </div>
        ) : error ? null : items.length ? (
          <div className="catalog-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{kind === 'properties' ? 'Sản phẩm' : kind === 'projects' ? 'Dự án' : 'Phân khu'}</th>
                  {kind === 'properties' ? (
                    <>
                      <th>Dự án / Phân khu</th>
                      <th>Thông số & giá</th>
                      <th>Công bố</th>
                      <th>Mở bán</th>
                    </>
                  ) : (
                    <>
                      <th>{kind === 'projects' ? 'Vị trí' : 'Dự án'}</th>
                      <th>Trạng thái</th>
                    </>
                  )}
                  <th>Cập nhật</th>
                  <th>
                    <span className="profile-sr-only">Thao tác</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="catalog-item-name">
                        <span>
                          <Building2 size={21} />
                        </span>
                        <div>
                          <strong>{item.name}</strong>
                          <small>
                            {item.code}
                            {kind === 'properties' && item.property_type
                              ? ` · ${propertyTypeLabels[item.property_type]}`
                              : ''}
                          </small>
                        </div>
                      </div>
                    </td>
                    {kind === 'properties' ? (
                      <>
                        <td>
                          <div className="catalog-parent-name">
                            {projectNames.get(item.project_id || '') || 'Đang tải dự án'}
                            <small>{subdivisionNames.get(item.subdivision_id || '') || 'Không thuộc phân khu'}</small>
                          </div>
                        </td>
                        <td>
                          <div className="catalog-property-numbers">
                            <strong>{priceLabel(item.price)}</strong>
                            <small>
                              {item.area} m²{item.bedrooms != null ? ` · ${item.bedrooms} PN` : ''}
                            </small>
                          </div>
                        </td>
                        <td>
                          <span className={`catalog-badge publication-${item.publication}`}>
                            {publicationLabels[item.publication!]}
                          </span>
                        </td>
                        <td>
                          <span className={`catalog-badge availability-${item.availability}`}>
                            {availabilityLabels[item.availability!]}
                          </span>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>
                          {kind === 'projects' ? (
                            <span className="catalog-location">
                              <MapPin size={14} />
                              {item.location}
                            </span>
                          ) : (
                            <div className="catalog-parent-name">
                              {projectNames.get(item.project_id || '') || 'Đang tải dự án'}
                              <small>{item.location}</small>
                            </div>
                          )}
                        </td>
                        <td>
                          <span
                            className={`catalog-badge ${item.archived ? 'publication-Archived' : 'publication-Published'}`}
                          >
                            {item.archived ? 'Lưu trữ' : 'Còn hiệu lực'}
                          </span>
                        </td>
                      </>
                    )}
                    <td>
                      <time className="catalog-updated" dateTime={item.updated_at}>
                        {new Date(item.updated_at).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
                        <small>Phiên bản {item.version}</small>
                      </time>
                    </td>
                    <td>
                      <div className="catalog-row-actions">
                        <button
                          className="catalog-edit-button"
                          onClick={() => void edit(item)}
                          disabled={!!opening}
                          aria-label={`${item.deleted_at ? 'Xem lịch sử' : 'Chỉnh sửa'} ${item.name}`}
                        >
                          {opening === item.id ? (
                            <LoaderCircle size={16} className="spin" />
                          ) : item.deleted_at ? (
                            <History size={16} />
                          ) : (
                            <Pencil size={16} />
                          )}
                        </button>
                        {kind === 'properties' && (
                          <button
                            className={`catalog-edit-button ${item.deleted_at ? '' : 'catalog-trash-button'}`}
                            onClick={() => setLifecycle({ item, action: item.deleted_at ? 'restore' : 'delete' })}
                            aria-label={`${item.deleted_at ? 'Khôi phục' : 'Xóa'} ${item.name}`}
                          >
                            {item.deleted_at ? <RotateCcw size={16} /> : <Trash2 size={16} />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="catalog-empty">
            <span>
              <Building2 size={32} />
            </span>
            <h3>
              {query || status || project
                ? 'Không tìm thấy kết quả'
                : trash
                  ? 'Thùng rác trống'
                  : scope === 'mine'
                    ? 'Bạn chưa tạo sản phẩm nào'
                    : `Chưa có ${names[kind]}`}
            </h3>
            <p>
              {query || status || project
                ? 'Thử thay đổi từ khóa hoặc bộ lọc để tìm dữ liệu phù hợp.'
                : trash
                  ? 'Các sản phẩm bị xóa sẽ xuất hiện ở đây để khôi phục.'
                  : `Bắt đầu bằng cách thêm ${names[kind]} đầu tiên vào danh mục.`}
            </p>
            {(!trash || !!(query || status || project)) && (
              <button
                className="button secondary"
                onClick={() => {
                  if (query || status || project) {
                    setSearch('');
                    setQuery('');
                    setStatus('');
                    setProject('');
                    setPage(1);
                  } else setEditor({ kind, detail: null });
                }}
              >
                {query || status || project ? 'Xóa bộ lọc' : `Thêm ${names[kind]} mới`}
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        )}
        <footer className="catalog-list-footer">
          <span>
            {total ? `${(page - 1) * 20 + 1}–${Math.min(page * 20, total)} trong ${total} ${names[kind]}` : '0 kết quả'}
            <small>20 mục / trang</small>
          </span>
          <div>
            <button onClick={() => setPage((p) => p - 1)} disabled={page <= 1 || loading} aria-label="Trang trước">
              <ChevronLeft size={17} />
            </button>
            <span>
              Trang {page} / {pages}
            </span>
            <button onClick={() => setPage((p) => p + 1)} disabled={page >= pages || loading} aria-label="Trang sau">
              <ChevronRight size={17} />
            </button>
          </div>
        </footer>
      </section>
      <div className="catalog-bottom-note">
        <ShieldCheck size={15} />
        <span>Quyền quản trị được kiểm tra ở mỗi thao tác. Dữ liệu lưu trữ vẫn giữ nguyên lịch sử.</span>
      </div>
      {lifecycle && (
        <CatalogLifecycleDialog
          {...lifecycle}
          onClose={() => setLifecycle(null)}
          onChanged={(message) => {
            setLifecycle(null);
            setNotice(message);
            setRevision((r) => r + 1);
          }}
        />
      )}
      {editor && (
        <CatalogEditor
          kind={editor.kind}
          detail={editor.detail}
          projects={projects}
          subdivisions={subdivisions}
          onClose={() => setEditor(null)}
          onSaved={() => setRevision((r) => r + 1)}
        />
      )}
    </>
  );
}
