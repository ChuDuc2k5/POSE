'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { readInquiryDraft } from '@/lib/inquiry-draft';

export function GoogleSignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const wantsInquiry = new URLSearchParams(window.location.search).get('next') === '/customer/inquiries/new' && readInquiryDraft();
      const response = await fetch('/api/auth/google', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acceptTerms: new FormData(event.currentTarget).get('acceptGoogleTerms') === 'on', next: wantsInquiry ? '/customer/inquiries/new' : '' }),
      });
      const data = await response.json();
      if (!response.ok || typeof data.url !== 'string') {
        setError(data.message || 'Chưa thể đăng nhập Google. Vui lòng thử lại.'); setBusy(false); return;
      }
      window.location.assign(data.url);
    } catch { setError('Không thể kết nối. Vui lòng thử lại hoặc đăng nhập bằng email.'); setBusy(false); }
  }
  return <div className="google-access">
    <div className="access-divider"><span>hoặc</span></div>
    <form onSubmit={submit}>
      <button type="submit" className="google-access-button" disabled={busy}>
        {busy ? <LoaderCircle size={20} className="spin"/> : <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.06.97-3.38.97-2.61 0-4.83-1.77-5.62-4.14H3.03v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.38 13.91A6 6 0 0 1 6.06 12c0-.66.11-1.3.32-1.91V7.5H3.03A10 10 0 0 0 2 12c0 1.61.39 3.14 1.03 4.5l3.35-2.59Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.97 5.5l3.35 2.59C7.17 7.72 9.39 5.95 12 5.95Z"/></svg>}
        {busy ? 'Đang chuyển đến Google…' : 'Tiếp tục với Google'}
      </button>
      <label className="google-access-terms"><input name="acceptGoogleTerms" type="checkbox" required disabled={busy}/><span>Tôi đồng ý với <Link href="/terms" target="_blank" rel="noopener noreferrer">điều khoản và chính sách quyền riêng tư</Link> khi tiếp tục với Google.</span></label>
    </form>
    {error && <div className="form-alert error" role="alert">{error}</div>}
  </div>;
}
