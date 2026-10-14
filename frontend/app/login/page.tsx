'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, ArrowRight } from 'lucide-react';
import { saveAuthSession } from '@/lib/auth-client';
import { useLanguage } from '@/components/providers/language-provider';

export default function LoginPage() {
  const router = useRouter();
  const { language, setLanguage, t } = useLanguage();
  const [email, setEmail] = useState('admin@revoland.vn');
  const [password, setPassword] = useState('Password123!');
  const [redirectPath, setRedirectPath] = useState('/');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    setRedirectPath(params.get('redirect') ?? '/');
  }, []);

  const handleLanguageChange = (nextLanguage: 'vi' | 'en') => {
    setLanguage(nextLanguage);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('http://localhost:3001/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? 'Login failed');
      }

      const session = {
        token: payload.data.token,
        user: {
          ...payload.data.user,
          language,
        },
      };

      saveAuthSession(session);
      router.push(redirectPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.14),_transparent_30%),linear-gradient(135deg,_#f8fafc,_#e2e8f0)] px-4 py-12">
      <div className="w-full max-w-md overflow-hidden rounded-[32px] border border-slate-200 bg-white/85 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl">
        <div className="border-b border-slate-200 px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-slate-500">REVOLAND</p>
              <h1 className="mt-2 text-2xl font-bold text-slate-900">{t('welcome')}</h1>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <Globe className="h-4 w-4" />
              <select aria-label="Language" value={language} onChange={(event) => handleLanguageChange(event.target.value as 'vi' | 'en')} className="bg-transparent text-sm outline-none">
                <option value="vi">🌐 Tiếng Việt</option>
                <option value="en">🌐 English</option>
              </select>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">{t('email')}</label>
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="name@company.com" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none ring-0 transition focus:border-sky-300 focus:bg-white" required />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">{t('password')}</label>
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="••••••••" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white" required />
          </div>

          {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

          <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3.5 font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
            {loading ? '...' : t('login')}
            {!loading && <ArrowRight className="h-4 w-4" />}
          </button>

          <div className="text-right">
            <button type="button" className="text-sm font-medium text-slate-600 hover:text-slate-900">{t('forgotPassword')}</button>
          </div>

          <div className="flex items-center gap-4 text-xs uppercase tracking-[0.2em] text-slate-400">
            <div className="h-px flex-1 bg-slate-200" />
            <span>OR</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <button type="button" className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
            <span className="text-lg">G</span>
            {t('googleSignin')}
          </button>

          <p className="text-center text-sm text-slate-600">
            {t('signupPrompt')}{' '}
            <button type="button" className="font-semibold text-slate-900">{t('signup')}</button>
          </p>
        </form>
      </div>
    </main>
  );
}
