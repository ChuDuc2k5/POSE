'use client';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Brand } from './brand';
import { validatePassword } from '@/lib/profile-validation';

export function PasswordRecovery({ reset = false, verificationFailed = false }: { reset?: boolean; verificationFailed?: boolean }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(verificationFailed ? 'Liên kết không hợp lệ, đã dùng hoặc hết hạn. Hãy yêu cầu liên kết mới.' : '');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(!reset);
  const [checking, setChecking] = useState(reset && !verificationFailed);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!reset || verificationFailed) return;
    const controller = new AbortController();
    fetch('/api/auth/reset-password', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) { setError(data.message); return; }
      setReady(data.ready);
      if (!data.ready) setError('Bạn cần mở liên kết khôi phục trong email để đặt lại mật khẩu.');
    }).catch(error => { if (error.name !== 'AbortError') setError('Không thể kiểm tra liên kết. Vui lòng tải lại trang.'); }).finally(() => setChecking(false));
    return () => controller.abort();
  }, [reset, verificationFailed]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = reset ? { password: form.get('password'), confirmPassword: form.get('confirmPassword') } : { email };
    if (reset) { const validation = validatePassword(input); if (validation) { setError(validation); return; } }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/auth/${reset ? 'reset-password' : 'forgot-password'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const data = await response.json();
      if (!response.ok) { setError(data.message); if (response.status === 401 || response.status === 409) setReady(false); return; }
      setNotice(data.message); if (reset) setDone(true);
    } catch { setError('Không thể kết nối. Vui lòng thử lại.'); }
    finally { setBusy(false); }
  }
  return <main className="account-page"><header className="account-header container"><Brand/><Link href="/sign-in" className="text-link">Về đăng nhập</Link></header><section className="account-card recovery-card">
    <span className="eyebrow">BẢO VỆ TÀI KHOẢN</span><h1>{reset ? 'Đặt lại mật khẩu' : 'Quên mật khẩu'}</h1>
    <p>{reset ? 'Chọn mật khẩu mới từ 12 đến 128 ký tự. Bạn sẽ cần đăng nhập lại sau khi lưu.' : 'Nhập email đã đăng ký để nhận hướng dẫn khôi phục tài khoản.'}</p>
    {error && <div className="form-alert error" role="alert">{error}</div>}{notice && <div className="form-alert success" role="status">{notice}</div>}
    {checking && <p role="status">Đang kiểm tra liên kết…</p>}
    {!checking && ready && !done && <form className="auth-form" onSubmit={submit}>{reset ? <><label>Mật khẩu mới<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy}/></label><label>Xác nhận mật khẩu<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy}/></label></> : <label>Địa chỉ email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} required disabled={busy}/></label>}<button className="button primary" disabled={busy}>{busy ? 'Đang xử lý…' : reset ? 'Lưu mật khẩu mới' : 'Gửi hướng dẫn khôi phục'}</button></form>}
    {reset && !ready && !checking && <Link href="/forgot-password" className="button primary">Yêu cầu liên kết mới</Link>}{done && <Link href="/sign-in" className="button primary">Đăng nhập với mật khẩu mới</Link>}
  </section></main>;
}
