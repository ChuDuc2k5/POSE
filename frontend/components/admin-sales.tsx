'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Building2, ChevronLeft, ChevronRight, History, LoaderCircle, LockKeyhole, MessagesSquare, Pencil, RefreshCw, Search, ShieldCheck, UserCheck, UserPlus, UserRound, Users } from 'lucide-react';
import { Brand } from './brand';
import { LogoutButton } from './logout-button';
import { SalesEditor, SalesHistoryDialog, SalesStatusDialog } from './admin-sales-dialogs';
import { catalogRequest } from '@/lib/catalog-client';
import { salesDate, type SalesAccount, type SalesList } from '@/lib/sales';
import styles from './admin-sales.module.css';

export function AdminSales({ name }: { name: string }) {
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('all'), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [data, setData] = useState<SalesList | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [opening, setOpening] = useState('');
  const [editor, setEditor] = useState<{ item: SalesAccount | null } | null>(null), [statusItem, setStatusItem] = useState<SalesAccount | null>(null), [history, setHistory] = useState<SalesAccount | null>(null);
  const [loadedKey, setLoadedKey] = useState(''), key = JSON.stringify([query, status, page, revision]), loading = loadedKey !== key;
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    const controller = new AbortController(), params = new URLSearchParams({ q: query, status, page: String(page), pageSize: '20' });
    catalogRequest<SalesList>(`/api/admin/sales?${params}`, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setData(result); setError('');
      if (page > 1 && !result.items.length) setPage(Math.max(1, Math.ceil(result.total / 20)));
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message || 'Chưa thể tải danh sách Sales.'); }).finally(() => { if (!controller.signal.aborted) setLoadedKey(key); });
    return () => controller.abort();
  }, [query, status, page, revision, key]);
  async function edit(item: SalesAccount) {
    setOpening(item.id); setError('');
    try { setEditor({ item: await catalogRequest<SalesAccount>(`/api/admin/sales/${item.id}`) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa thể mở hồ sơ Sales.'); }
    finally { setOpening(''); }
  }
  function changed(message: string) { setEditor(null); setStatusItem(null); setNotice(message); setRevision(value => value + 1); }
  const stats = data?.stats, pages = Math.max(1, Math.ceil((data?.total || 0) / 20));
  return <main className={`catalog-workspace ${styles.page}`}>
    <aside className="catalog-sidebar"><Brand light href="/admin"/><div className="catalog-sidebar-label">KHÔNG GIAN QUẢN TRỊ</div><nav aria-label="Quản trị"><Link href="/admin" className="catalog-sales-nav"><Building2 size={19}/>Bất động sản<ChevronRight size={15}/></Link><Link href="/admin/sales" className="catalog-sales-nav" aria-current="page"><Users size={19}/>Quản lý Sales<ChevronRight size={15}/></Link><Link href="/admin/inquiries" className="catalog-sales-nav"><MessagesSquare size={19}/>Yêu cầu tư vấn<ChevronRight size={15}/></Link></nav><div className="catalog-sidebar-note"><ShieldCheck size={22}/><h3>Quản lý đúng quyền.</h3><p>Tài khoản và lịch sử được giữ lại khi tạm khóa nhân viên.</p></div><div className="catalog-sidebar-bottom"><Link href="/account"><UserRound size={17}/>Hồ sơ cá nhân<ArrowRight size={14}/></Link><LogoutButton/></div></aside>
    <div className="catalog-workspace-main"><header className="catalog-topbar"><div><Link href="/admin">Quản trị</Link><ChevronRight size={13}/><strong>Nhân viên Sales</strong></div><Link href="/account" className="catalog-admin-user"><span>{name.slice(0, 1).toUpperCase()}</span><div><strong>{name}</strong><small>Quản trị viên</small></div></Link></header>
      <div className="catalog-content"><div className="catalog-title"><div><span className="eyebrow">QUẢN TRỊ NHÂN SỰ · M11</span><h1>Quản lý nhân viên Sales</h1><p>Tạo tài khoản, cập nhật thông tin và quản lý quyền truy cập của nhân viên.</p></div><button className="button primary" onClick={() => setEditor({ item: null })}><UserPlus size={18}/>Tạo tài khoản Sales</button></div>
        <div className={`catalog-stats ${styles.stats}`}>{[{ label: 'Tổng nhân viên Sales', value: stats?.total, icon: Users }, { label: 'Đang hoạt động', value: stats?.active, icon: UserCheck }, { label: 'Đang tạm khóa', value: stats?.suspended, icon: LockKeyhole }].map(({ label, value, icon: Icon }) => <article key={label}><div><span>{label}</span><span className="catalog-stat-icon"><Icon size={19}/></span></div><strong>{value === undefined ? '…' : value.toLocaleString('vi-VN')}</strong><small>Chỉ tính tài khoản có quyền Sales</small></article>)}</div>
        <section className="catalog-list-panel" aria-labelledby="sales-list-title"><div className="catalog-list-heading"><div><h2 id="sales-list-title">Danh sách Sales<span>{loading ? '…' : data?.total || 0}</span></h2><p>Tra cứu nhân viên theo họ tên, email hoặc số liên hệ.</p></div><button className="catalog-refresh" onClick={() => setRevision(value => value + 1)} disabled={loading} aria-label="Tải lại danh sách Sales"><RefreshCw size={16} className={loading ? 'spin' : ''}/><span>Tải lại</span></button></div>
          {notice && <div className="catalog-action-notice form-alert success" role="status">{notice}</div>}
          <div className="catalog-toolbar"><label className="catalog-search"><Search size={18}/><span className="profile-sr-only">Tìm nhân viên Sales</span><input value={search} onChange={event => setSearch(event.target.value)} maxLength={120} placeholder="Tìm họ tên, email hoặc số liên hệ…"/></label><label className={styles.statusFilter}><span className="profile-sr-only">Lọc trạng thái Sales</span><select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="all">Tất cả trạng thái</option><option value="active">Đang hoạt động</option><option value="suspended">Tạm khóa</option></select></label></div>
          {!loading && error && <div className="catalog-list-error form-alert error" role="alert">{error}<button onClick={() => setRevision(value => value + 1)}>Thử lại</button></div>}
          {loading ? <div className="catalog-list-loading" role="status"><LoaderCircle size={25} className="spin"/><p>Đang tải nhân viên Sales…</p></div> : error ? null : data?.items.length ? <div className="catalog-table-scroll"><table><thead><tr><th>Nhân viên</th><th>Liên hệ</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th><th>Cập nhật</th><th><span className="profile-sr-only">Thao tác</span></th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td><div className="catalog-item-name"><span><UserRound size={21}/></span><div><strong>{item.name}</strong><small>Sales · {item.id.slice(0, 8)}</small></div></div></td><td><div className={styles.contact}><strong>{item.email}</strong><small>{item.phone || 'Chưa có số liên hệ'}</small>{!item.email_verified && <small>Chờ xác minh email</small>}</div></td><td><span className={`catalog-badge ${item.status === 'active' ? 'publication-Published' : 'publication-Hidden'}`}>{item.status === 'active' ? 'Hoạt động' : item.requires_activation ? 'Chưa kích hoạt' : 'Tạm khóa'}</span></td><td><time className="catalog-updated">{salesDate(item.last_sign_in_at)}</time></td><td><time className="catalog-updated">{salesDate(item.updated_at)}<small>Phiên bản {item.version}</small></time></td><td><div className="catalog-row-actions"><button className="catalog-edit-button" onClick={() => void edit(item)} disabled={!!opening} aria-label={`Chỉnh sửa ${item.name}`}>{opening === item.id ? <LoaderCircle size={16} className="spin"/> : <Pencil size={16}/>}</button><button className="catalog-edit-button" onClick={() => setStatusItem(item)} aria-label={`${item.status === 'active' ? 'Tạm khóa' : 'Kích hoạt'} ${item.name}`}>{item.status === 'active' ? <LockKeyhole size={16}/> : <UserCheck size={16}/>}</button><button className="catalog-edit-button" onClick={() => setHistory(item)} aria-label={`Xem lịch sử ${item.name}`}><History size={16}/></button></div></td></tr>)}</tbody></table></div> : <div className="catalog-empty"><span><Users size={32}/></span><h3>{query || status !== 'all' ? 'Không tìm thấy nhân viên phù hợp' : 'Chưa có nhân viên Sales'}</h3><p>{query || status !== 'all' ? 'Thử đổi từ khóa hoặc trạng thái để tìm lại.' : 'Tạo tài khoản để nhân viên bắt đầu sử dụng không gian Sales.'}</p><button className="button secondary" onClick={() => { if (query || status !== 'all') { setSearch(''); setQuery(''); setStatus('all'); setPage(1); } else setEditor({ item: null }); }}>{query || status !== 'all' ? 'Xóa bộ lọc' : 'Tạo Sales đầu tiên'}<ArrowRight size={16}/></button></div>}
          <footer className="catalog-list-footer"><span>{data?.total ? `${(page - 1) * 20 + 1}–${Math.min(page * 20, data.total)} trong ${data.total} nhân viên` : '0 kết quả'}<small>20 nhân viên / trang</small></span><div><button onClick={() => setPage(value => value - 1)} disabled={page <= 1 || loading} aria-label="Trang trước"><ChevronLeft size={17}/></button><span>Trang {page} / {pages}</span><button onClick={() => setPage(value => value + 1)} disabled={page >= pages || loading} aria-label="Trang sau"><ChevronRight size={17}/></button></div></footer>
        </section><div className="catalog-bottom-note"><ShieldCheck size={15}/><span>Mỗi thao tác đều kiểm tra quyền Admin và ghi lịch sử thay đổi.</span></div>
      </div>
    </div>
    {editor && <SalesEditor item={editor.item} onClose={() => setEditor(null)} onChanged={changed}/>}
    {statusItem && <SalesStatusDialog item={statusItem} onClose={() => setStatusItem(null)} onChanged={changed}/>}
    {history && <SalesHistoryDialog item={history} onClose={() => setHistory(null)}/>}
  </main>;
}
