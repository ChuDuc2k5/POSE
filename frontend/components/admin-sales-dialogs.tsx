'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { History, LoaderCircle, LockKeyhole, UserPlus, Users, X } from 'lucide-react';
import { CatalogRequestError, catalogRequest } from '@/lib/catalog-client';
import { normalizePhone } from '@/lib/profile-validation';
import { salesActionLabels, salesDate, type SalesAccount, type SalesHistory } from '@/lib/sales';
import styles from './admin-sales.module.css';

type Changed = (message: string) => void;
function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = ref.current; element?.showModal(); return () => element?.close(); }, []);
  return ref;
}

export function SalesEditor({ item, onClose, onChanged }: { item: SalesAccount | null; onClose: () => void; onChanged: Changed }) {
  const ref = useModal(), creating = !item;
  const [name, setName] = useState(item?.name || ''), [phone, setPhone] = useState(item?.phone || ''), [email, setEmail] = useState(item?.email || '');
  const [password, setPassword] = useState(''), [confirmPassword, setConfirmPassword] = useState(''), [reason, setReason] = useState(''), [showPassword, setShowPassword] = useState(false);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [fields, setFields] = useState<Record<string, string>>({});
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const next: Record<string, string> = {};
    if (name.trim().length < 2 || name.trim().length > 80) next.name = 'Họ tên từ 2 đến 80 ký tự.';
    if (normalizePhone(phone) === null) next.phone = 'Nhập số điện thoại hợp lệ hoặc để trống.';
    if (creating && (password.length < 12 || password.length > 128)) next.password = 'Mật khẩu từ 12 đến 128 ký tự.';
    if (creating && password !== confirmPassword) next.confirmPassword = 'Mật khẩu xác nhận chưa khớp.';
    if (!creating && (reason.trim().length < 3 || reason.trim().length > 1000)) next.reason = 'Nhập lý do từ 3 đến 1.000 ký tự.';
    setFields(next); if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const body = creating ? { name: name.trim(), email, phone, password, confirmPassword, request_key: requestKey } : { name: name.trim(), phone, version: item.version, profile_version: item.profile_version, reason: reason.trim() };
      await catalogRequest(`/api/admin/sales${item ? `/${item.id}` : ''}`, { method: creating ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setPassword(''); setConfirmPassword(''); onChanged(creating ? 'Đã tạo tài khoản Sales.' : 'Đã cập nhật thông tin Sales.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể lưu Sales.');
      if (cause instanceof CatalogRequestError) setFields(cause.fields);
    } finally { setBusy(false); }
  }
  return <dialog ref={ref} className={`catalog-editor ${styles.dialog}`} aria-labelledby="sales-editor-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={submit}><div className="catalog-editor-header"><span className="catalog-editor-symbol">{creating ? <UserPlus size={23}/> : <Users size={23}/>}</span><h2 id="sales-editor-title">{creating ? 'Tạo tài khoản Sales' : 'Cập nhật Sales'}</h2><button type="button" className="catalog-icon-button" aria-label="Đóng cửa sổ Sales" onClick={onClose} disabled={busy}><X size={21}/></button></div>
      <div className="catalog-editor-body"><p className={styles.help}>{creating ? 'Tạo tài khoản nội bộ cho nhân viên. Sales đăng nhập bằng email và mật khẩu ban đầu, sau đó có thể đổi mật khẩu trong Hồ sơ cá nhân.' : 'Cập nhật thông tin liên hệ của nhân viên. Email đăng nhập được giữ nguyên ở màn hình này.'}</p>
        <fieldset disabled={busy} className={styles.formGrid}>
          <label className={styles.field}>Họ và tên<input value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={80} autoComplete="off" aria-invalid={!!fields.name}/>{fields.name && <small className={styles.fieldError}>{fields.name}</small>}</label>
          <label className={styles.field}>Số liên hệ<input type="tel" value={phone} onChange={e => setPhone(e.target.value)} maxLength={30} placeholder="0912345678 hoặc +84912345678" autoComplete="off" aria-invalid={!!fields.phone}/>{fields.phone && <small className={styles.fieldError}>{fields.phone}</small>}</label>
          <label className={`${styles.field} ${styles.full}`}>Email đăng nhập<input type="email" value={email} onChange={e => setEmail(e.target.value)} readOnly={!creating} required maxLength={254} autoComplete="off" aria-invalid={!!fields.email}/>{fields.email && <small className={styles.fieldError}>{fields.email}</small>}</label>
          {creating ? <><label className={styles.field}>Mật khẩu ban đầu<input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} minLength={12} maxLength={128} required autoComplete="new-password" aria-invalid={!!fields.password}/>{fields.password && <small className={styles.fieldError}>{fields.password}</small>}</label><label className={styles.field}>Xác nhận mật khẩu<input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} minLength={12} maxLength={128} required autoComplete="new-password" aria-invalid={!!fields.confirmPassword}/>{fields.confirmPassword && <small className={styles.fieldError}>{fields.confirmPassword}</small>}</label><label className={styles.check}><input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)}/>Hiện mật khẩu</label></> : <label className={`${styles.field} ${styles.full}`}>Lý do cập nhật<textarea value={reason} onChange={e => setReason(e.target.value)} required minLength={3} maxLength={1000} rows={3} aria-invalid={!!fields.reason}/>{fields.reason && <small className={styles.fieldError}>{fields.reason}</small>}</label>}
        </fieldset>
        {error && <div className="form-alert error" role="alert">{error}</div>}
      </div><div className="catalog-editor-footer"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Hủy</button><button className="button primary" disabled={busy}>{busy && <LoaderCircle size={16} className="spin"/>}{creating ? 'Tạo tài khoản' : 'Lưu thông tin'}</button></div>
    </form>
  </dialog>;
}

export function SalesStatusDialog({ item, onClose, onChanged }: { item: SalesAccount; onClose: () => void; onChanged: Changed }) {
  const ref = useModal(), suspending = item.status === 'active';
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason.trim().length < 3 || reason.trim().length > 1000) { setError('Nhập lý do từ 3 đến 1.000 ký tự.'); return; }
    setBusy(true); setError('');
    try {
      await catalogRequest(`/api/admin/sales/${item.id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: suspending ? 'suspended' : 'active', version: item.version, reason: reason.trim() }) });
      onChanged(suspending ? 'Đã tạm khóa Sales. Nhân viên không còn truy cập được ứng dụng bằng phiên cũ.' : 'Đã kích hoạt Sales. Nhân viên cần đăng nhập lại để truy cập.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể đổi trạng thái.'); } finally { setBusy(false); }
  }
  return <dialog ref={ref} className={`catalog-editor ${styles.dialog}`} aria-labelledby="sales-status-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><form onSubmit={submit}>
    <div className="catalog-editor-header"><span className="catalog-editor-symbol"><LockKeyhole size={23}/></span><h2 id="sales-status-title">{suspending ? 'Tạm khóa Sales?' : 'Kích hoạt Sales?'}</h2><button type="button" className="catalog-icon-button" aria-label="Đóng xác nhận" onClick={onClose} disabled={busy}><X size={21}/></button></div>
    <div className="catalog-editor-body"><strong>{item.name}</strong><p className={styles.help}>{suspending ? 'Nhân viên sẽ mất quyền truy cập. Thông tin, khách hàng và lịch sử hoạt động vẫn được giữ lại.' : 'Nhân viên sẽ được mở quyền Sales và cần đăng nhập lại. Lịch sử tài khoản được giữ nguyên.'}</p><label className={styles.field}>Lý do {suspending ? 'tạm khóa' : 'kích hoạt'}<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={3} maxLength={1000} required rows={3} disabled={busy}/></label>{error && <div className="form-alert error" role="alert">{error}</div>}</div>
    <div className="catalog-editor-footer"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Hủy</button><button className={`button ${suspending ? styles.danger : 'primary'}`} disabled={busy}>{busy && <LoaderCircle size={16} className="spin"/>}{suspending ? 'Xác nhận tạm khóa' : 'Xác nhận kích hoạt'}</button></div>
  </form></dialog>;
}

export function SalesHistoryDialog({ item, onClose }: { item: SalesAccount; onClose: () => void }) {
  const ref = useModal();
  const [page, setPage] = useState(1), [result, setResult] = useState<{ items: SalesHistory[]; total: number; page: number; pageSize: number } | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [loadedKey, setLoadedKey] = useState(''), key = `${page}:${attempt}`, loading = loadedKey !== key;
  useEffect(() => {
    const controller = new AbortController();
    catalogRequest<NonNullable<typeof result>>(`/api/admin/sales/${item.id}/history?page=${page}`, { signal: controller.signal }).then(data => { setResult(data); setError(''); }).catch(cause => { if (!controller.signal.aborted) setError(cause.message || 'Không thể tải lịch sử.'); }).finally(() => { if (!controller.signal.aborted) setLoadedKey(key); });
    return () => controller.abort();
  }, [item.id, page, attempt, key]);
  const fieldNames = { name: 'Họ tên', email: 'Email', phone: 'Số liên hệ', status: 'Trạng thái' } as const;
  function display(value: string) { return value === 'active' ? 'Hoạt động' : value === 'suspended' ? 'Tạm khóa' : value || 'Chưa có'; }
  return <dialog ref={ref} className={`catalog-editor ${styles.dialog} ${styles.historyDialog}`} aria-labelledby="sales-history-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="catalog-editor-header"><span className="catalog-editor-symbol"><History size={23}/></span><h2 id="sales-history-title">Lịch sử thay đổi</h2><button type="button" className="catalog-icon-button" aria-label="Đóng lịch sử" onClick={onClose}><X size={21}/></button></div>
    <div className="catalog-editor-body"><p className={styles.help}>{item.name} · {item.email}</p>{loading ? <p role="status">Đang tải lịch sử…</p> : error ? <div className="form-alert error" role="alert">{error}<button className="text-link" onClick={() => setAttempt(attempt + 1)}>Thử lại</button></div> : result?.items.length ? <ol className={styles.history}>{result.items.map(entry => <li key={entry.id}><div className={styles.historyTop}><strong>{salesActionLabels[entry.action]}</strong><time dateTime={entry.created_at}>{salesDate(entry.created_at)}</time></div><p>{entry.actor_name}</p><blockquote>{entry.reason}</blockquote><dl>{(Object.keys(fieldNames) as (keyof typeof fieldNames)[]).filter(field => entry.before_data?.[field] !== entry.after_data[field]).map(field => <div key={field}><dt>{fieldNames[field]}</dt><dd>{entry.before_data && <><span>{display(entry.before_data[field])}</span><span aria-label="đổi thành"> → </span></>}{display(entry.after_data[field])}</dd></div>)}</dl></li>)}</ol> : <div className="customer-empty"><p>Chưa có thay đổi được ghi nhận từ M11.</p></div>}</div>
    <div className="catalog-editor-footer"><div className={styles.historyPages}><button className="button secondary" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Trang trước</button><span>Trang {page} / {Math.max(1, Math.ceil((result?.total || 0) / 20))}</span><button className="button secondary" disabled={loading || page * 20 >= (result?.total || 0)} onClick={() => setPage(page + 1)}>Trang sau</button></div></div>
  </dialog>;
}
