'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, LoaderCircle, ShieldCheck, UserRound, Camera, Mail, Phone, Bell, Check, LockKeyhole, History as HistoryIcon, Settings2 } from 'lucide-react';
import { Brand } from './brand';
import { LogoutButton } from './logout-button';
import { roleHome, roleLabels, type Role } from '@/lib/roles';
import { validateProfile } from '@/lib/profile-validation';
import type { Profile } from '@/lib/account-server';

type User = { name: string; email: string; role: Role };
type History = { id: string; action: string; changed_fields: string[]; created_at: string };
const fieldLabels: Record<string, string> = { name: 'họ tên', phone: 'số liên hệ', avatar: 'ảnh đại diện', avatarPath: 'ảnh đại diện', notifications: 'tùy chọn thông báo', notificationsEnabled: 'tùy chọn thông báo' };
export function ProfileEditor() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notificationsEnabled, setNotifications] = useState(true);
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  function applyProfile(value: Profile) { setProfile(value); setName(value.name); setPhone(value.phone); setNotifications(value.notificationsEnabled); }
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([fetch('/api/auth/me', { signal: controller.signal }), fetch('/api/account/profile', { signal: controller.signal })]).then(async ([identity, response]) => {
      if (identity.status === 401 || response.status === 401) { router.replace('/sign-in'); return; }
      const [identityData, data] = await Promise.all([identity.json(), response.json()]);
      if (!identity.ok || !response.ok) { setError(data.message || identityData.message); return; }
      setUser(identityData.user); applyProfile(data.profile); setHistory(data.history);
    }).catch(error => { if (error.name !== 'AbortError') setError('Không thể tải hồ sơ. Vui lòng tải lại trang.'); });
    return () => controller.abort();
  }, [router]);
  async function reloadHistory() { const response = await fetch('/api/account/profile'); if (response.ok) { const data = await response.json(); setHistory(data.history); } }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!profile) return;
    const input = { name, phone, notificationsEnabled, version: profile.version };
    const validation = validateProfile(input); if (validation) { setError(validation); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/account/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const data = await response.json(); if (!response.ok) { setError(data.message); return; }
      applyProfile(data.profile); setOtpSent(false); setOtp(''); setNotice(data.message); await reloadHistory(); router.refresh();
    } catch { setError('Không thể lưu hồ sơ. Vui lòng thử lại.'); } finally { setBusy(false); }
  }
  async function upload(file: File | undefined) {
    if (!file || !profile) return;
    if (file.size > 2097152 || !['image/jpeg','image/png','image/webp'].includes(file.type)) { setError('Chọn ảnh JPG, PNG hoặc WebP, tối đa 2 MB.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const form = new FormData(); form.set('file', file); form.set('version', String(profile.version));
      const response = await fetch('/api/account/avatar', { method: 'POST', body: form });
      const data = await response.json(); if (!response.ok) { setError(data.message); return; }
      setProfile(data.profile); setNotice(data.message); await reloadHistory();
    } catch { setError('Không thể tải ảnh lên. Vui lòng thử lại.'); } finally { setBusy(false); }
  }
  async function verifyPhone(action: 'send' | 'verify') {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/account/phone/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'verify' ? { token: otp } : {}) });
      const data = await response.json(); if (!response.ok) { setError(data.message); return; }
      setNotice(data.message); if (action === 'send') setOtpSent(true);
      if (data.profile) { applyProfile(data.profile); setOtpSent(false); setOtp(''); }
    } catch { setError('Không thể xác minh số điện thoại. Vui lòng thử lại.'); } finally { setBusy(false); }
  }
  const hasChanges = !!profile && (name !== profile.name || phone !== profile.phone || notificationsEnabled !== profile.notificationsEnabled);
  return <main className="profile-page">
    <header className="profile-header"><div className="profile-container"><Brand href={user ? roleHome(user.role) : '/'}/><Link href={user ? roleHome(user.role) : '/'} className="profile-home-link"><ArrowLeft size={16}/> Về trang chủ</Link></div></header>
    <div className="profile-container profile-body">
      <div className="profile-page-title"><div><span className="eyebrow">KHÔNG GIAN CÁ NHÂN</span><h1>Hồ sơ của bạn</h1><p>Quản lý thông tin và tùy chỉnh tài khoản theo cách của bạn.</p></div><span className="profile-title-tag"><Settings2 size={16}/> Cài đặt tài khoản</span></div>
      <div className="profile-feedback" aria-live="polite">{error && <div className="form-alert error" role="alert">{error}</div>}{notice && <div className="form-alert success" role="status"><Check size={18}/>{notice}</div>}</div>
      {!profile && !error && <div className="profile-loading"><LoaderCircle className="spin" size={24}/><p>Đang tải hồ sơ của bạn…</p></div>}
      {profile && user && <div className="profile-layout">
        <aside className="profile-sidebar">
          <section className="profile-identity">
            <div className="profile-cover" aria-hidden="true"><span/><span/><span/></div>
            <div className="profile-identity-content">
              <div className="profile-avatar-wrap"><span className="profile-avatar">{profile.avatarUrl ? <Image src={profile.avatarUrl} width={96} height={96} unoptimized alt="Ảnh đại diện của bạn"/> : <UserRound size={39}/>}</span><label className="profile-camera" aria-disabled={busy}><Camera size={16}/><span className="profile-sr-only">Thay ảnh đại diện</span><input className="profile-sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); }}/></label></div>
              <h2>{profile.name}</h2><span className="profile-role"><span/>{roleLabels[user.role]}</span><p className="profile-identity-email">{user.email}</p>
              <span className="profile-email-badge"><ShieldCheck size={14}/> Email đã xác minh</span>
              <p className="profile-avatar-hint">Nhấn biểu tượng máy ảnh để thay ảnh.<br/>JPG, PNG, WebP · Tối đa 2 MB</p>
            </div>
            <nav className="profile-section-nav" aria-label="Các phần hồ sơ"><a href="#personal-details"><UserRound size={18}/> Thông tin cá nhân <ArrowRight size={15}/></a><a href="#security"><ShieldCheck size={18}/> Bảo mật tài khoản <ArrowRight size={15}/></a><a href="#activity"><HistoryIcon size={18}/> Lịch sử cập nhật <ArrowRight size={15}/></a></nav>
            <div className="profile-sidebar-footer">{user.role !== 'User' && <Link href={roleHome(user.role)} className="text-link">Vào không gian làm việc <ArrowRight size={15}/></Link>}<LogoutButton/></div>
          </section>
          <div className="profile-sidebar-note"><ShieldCheck size={20}/><p>Tài khoản trong tầm tay bạn.<small>Chủ động cập nhật thông tin và lựa chọn thông báo phù hợp.</small></p></div>
        </aside>
        <div className="profile-main">
          <section className="profile-panel" id="personal-details">
            <div className="profile-panel-heading"><span className="profile-panel-icon"><UserRound size={20}/></span><div><h2>Thông tin cá nhân</h2><p>Thông tin giúp NexCall kết nối với bạn tốt hơn.</p></div></div>
            <form onSubmit={save} className="auth-form profile-settings-form">
              <div className="profile-fields"><label>Họ và tên<input autoComplete="name" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={80} required disabled={busy}/></label><label>Số liên hệ<input aria-label="Số liên hệ" type="tel" autoComplete="tel" value={phone} onChange={event => { setPhone(event.target.value); setOtpSent(false); }} placeholder="0912345678" maxLength={25} disabled={busy}/><small>{!profile.phone ? 'Thêm số điện thoại để thuận tiện liên hệ.' : profile.phoneVerified ? 'Số đang lưu đã được xác minh.' : 'Số đang lưu chưa được xác minh.'}</small></label></div>
              <label>Địa chỉ email<div className="profile-readonly"><Mail size={17}/><input aria-label="Địa chỉ email" type="email" value={user.email} readOnly/><span><Check size={13}/> Đã xác minh</span></div><small className="profile-field-help">Email được sử dụng để đăng nhập và nhận thông tin tài khoản.</small></label>
              <label className="profile-notification"><span className="profile-notification-icon"><Bell size={20}/></span><span className="profile-notification-copy"><strong>Thông báo tài khoản</strong><small>Nhận thông báo bổ trợ về hoạt động tài khoản. Thông báo nghiệp vụ bắt buộc vẫn được hiển thị.</small></span><input type="checkbox" role="switch" aria-label="Nhận thông báo bổ trợ" checked={notificationsEnabled} onChange={event => setNotifications(event.target.checked)} disabled={busy}/></label>
              <div className="profile-save-row"><span>{hasChanges ? <><span className="profile-unsaved-dot"/> Có thay đổi chưa lưu</> : <><Check size={15}/> Thông tin đã được lưu</>}</span><button className="button primary" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={17}/> Đang xử lý…</> : <>Lưu hồ sơ <ArrowRight size={17}/></>}</button></div>
            </form>
          </section>
          <section className="profile-panel" id="security">
            <div className="profile-panel-heading"><span className="profile-panel-icon"><ShieldCheck size={20}/></span><div><h2>Bảo mật tài khoản</h2><p>Kiểm tra xác minh và quản lý quyền truy cập của bạn.</p></div></div>
            <div className="profile-security-row"><span className="profile-security-icon"><LockKeyhole size={19}/></span><div><h3>Mật khẩu đăng nhập</h3><p>Đặt lại mật khẩu thông qua email xác minh.</p></div><Link href="/forgot-password" className="profile-outline-link">Khôi phục mật khẩu <ArrowRight size={15}/></Link></div>
            <div className="profile-security-row"><span className="profile-security-icon"><Phone size={19}/></span><div><h3>Xác minh số điện thoại <span className={`profile-status ${profile.phoneVerified ? 'verified' : ''}`}>{profile.phoneVerified ? 'Đã xác minh' : 'Chưa xác minh'}</span></h3><p>{profile.phone ? profile.phone : 'Thêm và lưu số liên hệ trước khi xác minh.'}</p></div>{profile.phone && !profile.phoneVerified && <button type="button" className="profile-outline-link" onClick={() => verifyPhone('send')} disabled={busy || phone !== profile.phone}>{busy ? 'Đang xử lý…' : otpSent ? 'Gửi lại mã' : 'Gửi mã xác minh'}</button>}</div>
            {profile.phone && !profile.phoneVerified && <p className="profile-security-hint">{phone !== profile.phone ? 'Bạn cần lưu số liên hệ mới trước khi yêu cầu mã xác minh.' : 'Mã xác minh sẽ được gửi đến số liên hệ đang lưu.'}</p>}
            {otpSent && <form className="auth-form profile-otp-form" onSubmit={event => { event.preventDefault(); void verifyPhone('verify'); }}><label>Mã xác minh<input value={otp} onChange={event => setOtp(event.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="Nhập mã 6 chữ số" pattern="[0-9]{6}" minLength={6} maxLength={6} required disabled={busy}/></label><button className="button primary" disabled={busy}>Xác minh số điện thoại</button></form>}
          </section>
          <section className="profile-panel" id="activity">
            <div className="profile-panel-heading"><span className="profile-panel-icon"><HistoryIcon size={20}/></span><div><h2>Lịch sử cập nhật</h2><p>Các thay đổi gần đây trên tài khoản của bạn.</p></div><span className="profile-history-label">HOẠT ĐỘNG</span></div>
            {history.length ? <ul className="profile-timeline">{history.map(entry => <li key={entry.id}><span className="profile-timeline-dot"><Check size={12}/></span><div><p>{entry.action === 'password_recovered' ? 'Đặt lại mật khẩu' : entry.action === 'phone_verified' ? 'Xác minh số điện thoại' : `Cập nhật ${entry.changed_fields.map(field => fieldLabels[field] || field).join(', ')}`}</p><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</time></div></li>)}</ul> : <div className="profile-history-empty"><HistoryIcon size={24}/><p>Chưa có cập nhật hồ sơ.<small>Các thay đổi của bạn sẽ xuất hiện tại đây.</small></p></div>}
          </section>
        </div>
      </div>}
      {error && !profile && <button className="button secondary" onClick={() => window.location.reload()}>Tải lại trang</button>}
      <footer className="profile-footer"><span>© {new Date().getFullYear()} NexCall · Không gian cá nhân</span><Link href="/terms">Điều khoản & quyền riêng tư <ArrowRight size={13}/></Link></footer>
    </div>
  </main>;
}
