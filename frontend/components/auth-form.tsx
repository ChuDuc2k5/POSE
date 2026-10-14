'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, LoaderCircle, Mail, ShieldCheck, LockKeyhole, UserRound, UsersRound, PhoneCall, ClipboardCheck, Sparkles } from 'lucide-react';
import { Brand } from './brand';
import { validateCredentials } from '@/lib/auth-validation';

export function AuthForm({ mode, verificationFailed = false }: { mode: 'signin' | 'signup'; verificationFailed?: boolean }) {
  const signup = mode === 'signup';
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(verificationFailed ? 'Liên kết xác minh không hợp lệ, đã dùng hoặc đã hết hạn. Bạn có thể gửi lại liên kết bên dưới.' : '');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registered, setRegistered] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const input = { email, password, name: values.get('name'), confirmPassword: values.get('confirmPassword'), acceptTerms: values.get('acceptTerms') === 'on' };
    const validation = validateCredentials(input, signup);
    if (validation) { setError(validation); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const data = await response.json();
      if (!response.ok) { setError(data.message); return; }
      if (signup) { setNotice(data.message); setRegistered(true); setPassword(''); }
      else { router.replace(data.destination || '/'); router.refresh(); }
    } catch { setError('Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.'); }
    finally { setBusy(false); }
  }
  async function resend() {
    if (!email.trim()) { setError('Nhập địa chỉ email của bạn để gửi lại liên kết.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/auth/resend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const data = await response.json();
      if (!response.ok) setError(data.message); else setNotice(data.message);
    } catch { setError('Không thể kết nối. Vui lòng thử lại.'); }
    finally { setBusy(false); }
  }
  return <main className={`access-page ${signup ? 'access-signup' : ''}`}>
    <aside className="access-story">
      <Brand light/>
      <div className="access-story-copy">
        <span className="access-kicker"><span/> KẾT NỐI THÔNG MINH CÙNG AI</span>
        <h2>Mỗi kết nối,<br/>một <em>cơ hội mới.</em></h2>
        <p>Từ cuộc trò chuyện đầu tiên đến hành trình chăm sóc. NexCall giúp mọi tương tác trở nên có ý nghĩa.</p>
      </div>
      <div className="access-journey">
        <div className="journey-heading"><span><Sparkles size={16}/> HÀNH TRÌNH CÙNG NexCall</span><span className="journey-orbit" aria-hidden="true"/></div>
        <div className="journey-flow">
          <div><span className="journey-icon"><UsersRound size={24}/></span><strong>Kết nối</strong><small>Tiếp nhận nhu cầu</small></div>
          <ArrowRight size={17} aria-hidden="true"/>
          <div><span className="journey-icon active"><PhoneCall size={24}/></span><strong>Tư vấn AI</strong><small>Hỗ trợ thông minh</small></div>
          <ArrowRight size={17} aria-hidden="true"/>
          <div><span className="journey-icon"><ClipboardCheck size={24}/></span><strong>Chăm sóc</strong><small>Đồng hành cùng bạn</small></div>
        </div>
        <div className="journey-wave" aria-hidden="true">{[8,16,28,19,35,46,27,40,56,34,22,42,30,50,38,24,44,32,18,29,14,8].map((height, index) => <i key={index} style={{ height }}/>)}</div>
        <p><span/> AI hỗ trợ · Con người đồng hành</p>
      </div>
      <div className="access-story-footer"><span className="access-shield"><ShieldCheck size={21}/></span><p>Bạn luôn chủ động lựa chọn.<small>Tạo tài khoản không tự động đăng ký cuộc gọi.</small></p></div>
      <span className="access-decoration" aria-hidden="true"/>
    </aside>
    <section className="access-content">
      <header className="access-topbar"><Link href="/" className="back-link"><ArrowLeft size={16}/> Về trang chủ</Link><Link href="/terms" className="access-help">Điều khoản & quyền riêng tư <ArrowRight size={14}/></Link></header>
      <div className="access-mobile-brand"><Brand/></div>
      <div className="access-form-wrap">
        <nav className="access-mode" aria-label="Tài khoản"><Link href="/sign-in" aria-current={!signup ? 'page' : undefined}>Đăng nhập</Link><Link href="/sign-up" aria-current={signup ? 'page' : undefined}>Đăng ký</Link></nav>
        <span className="access-form-icon">{registered ? <Mail size={24}/> : signup ? <UserRound size={24}/> : <LockKeyhole size={24}/>}</span>
        <h1>{registered ? 'Kiểm tra hộp thư của bạn' : signup ? 'Bắt đầu cùng NexCall' : 'Chào mừng trở lại.'}</h1>
        <p className="access-intro">{registered ? 'Xác minh email để hoàn tất đăng ký và bắt đầu hành trình của bạn.' : signup ? 'Một tài khoản, nhiều kết nối. Tạo tài khoản khách hàng của bạn chỉ với vài bước.' : 'Đăng nhập để tiếp tục hành trình kết nối và quản lý tài khoản của bạn.'}</p>
        {error && <div className="form-alert error" role="alert">{error}</div>}
        {notice && <div className="form-alert success" role="status"><Mail size={18}/><span>{notice}</span></div>}
        <form onSubmit={submit} className="auth-form access-form">
          {signup && !registered && <label>Họ và tên<div className="access-input"><UserRound size={18} aria-hidden="true"/><input name="name" autoComplete="name" placeholder="Nguyễn Minh Anh" required minLength={2} maxLength={80} disabled={busy}/></div></label>}
          <label>Địa chỉ email<div className="access-input"><Mail size={18} aria-hidden="true"/><input name="email" type="email" autoComplete="email" placeholder="ban@example.com" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} required disabled={busy}/></div></label>
          {!registered && <>
            <label><span className="access-label-row"><span>Mật khẩu</span>{!signup && <Link href="/forgot-password">Quên mật khẩu?</Link>}</span><div className="password-input access-input"><LockKeyhole size={18} aria-hidden="true"/><input name="password" aria-label="Mật khẩu" type={visible ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} placeholder={signup ? 'Tối thiểu 12 ký tự' : 'Nhập mật khẩu của bạn'} value={password} onChange={e => setPassword(e.target.value)} minLength={signup ? 12 : undefined} maxLength={128} required disabled={busy}/><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} aria-pressed={visible} disabled={busy}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>
            {signup && <>
              <div className="access-password-hint"><span className={password.length >= 12 ? 'met' : ''}><Check size={13}/> Ít nhất 12 ký tự</span><span>Không dùng thông tin dễ đoán</span></div>
              <label>Xác nhận mật khẩu<div className="access-input"><LockKeyhole size={18} aria-hidden="true"/><input name="confirmPassword" type={visible ? 'text' : 'password'} autoComplete="new-password" placeholder="Nhập lại mật khẩu" minLength={12} maxLength={128} required disabled={busy}/></div></label>
              <label className="checkbox-label"><input type="checkbox" name="acceptTerms" required disabled={busy}/><span>Tôi đồng ý với <Link href="/terms" target="_blank" rel="noopener noreferrer">điều khoản sử dụng và thông tin quyền riêng tư</Link>.</span></label>
            </>}
            <button className="button primary submit-button" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={18}/> Đang xử lý…</> : <>{signup ? 'Tạo tài khoản' : 'Đăng nhập'}<ArrowRight size={18}/></>}</button>
          </>}
        </form>
        <button type="button" className="access-resend" onClick={resend} disabled={busy}><Mail size={14}/>{registered ? 'Gửi lại email xác minh' : 'Chưa xác minh email? Gửi lại liên kết'}</button>
        <div className="access-switch">{signup ? 'Đã có tài khoản?' : 'Chưa có tài khoản?'} <Link href={signup ? '/sign-in' : '/sign-up'}>{signup ? 'Đăng nhập' : 'Đăng ký ngay'} <ArrowRight size={14}/></Link></div>
        <p className="access-security"><ShieldCheck size={14}/> Kết nối an toàn. Thông tin được bảo vệ.</p>
      </div>
      <footer className="access-footer"><span>© {new Date().getFullYear()} NexCall</span><span>AI Calling & Lead Management</span></footer>
    </section>
  </main>;
}
