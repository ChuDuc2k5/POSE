'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronDown, Globe, LogOut, User } from 'lucide-react';
import { getAuthSession, clearAuthSession } from '@/lib/auth-client';
import { useLanguage } from '@/components/providers/language-provider';

export function SiteHeader() {
  const { language, setLanguage, t } = useLanguage();
  const [session, setSession] = useState(getAuthSession());
  const [languageOpen, setLanguageOpen] = useState(false);

  useEffect(() => {
    setSession(getAuthSession());
  }, []);

  const handleLanguageChange = (nextLanguage: 'vi' | 'en') => {
    setLanguage(nextLanguage);
    setLanguageOpen(false);
    setSession((current) => current ? { ...current, user: { ...current.user, language: nextLanguage } } : current);
  };

  const handleLogout = () => {
    clearAuthSession();
    setSession(null);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white">R</div>
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">REVOLAND</p>
            <p className="text-sm font-semibold text-slate-900">Real Estate AI</p>
          </div>
        </Link>

        <nav className="hidden items-center gap-8 text-sm text-slate-600 md:flex">
          <Link href="#discover" className="transition hover:text-slate-900">{t('navDiscover')}</Link>
          <Link href="#featured" className="transition hover:text-slate-900">{t('navFeatured')}</Link>
          <Link href="#why-us" className="transition hover:text-slate-900">{t('navWhyUs')}</Link>
          <Link href="/chat" className="transition hover:text-slate-900">{t('aiAgent')}</Link>
        </nav>

        <div className="flex items-center gap-3">
          <div className="relative hidden md:block">
            <button type="button" onClick={() => setLanguageOpen((open) => !open)} aria-expanded={languageOpen} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <Globe className="h-4 w-4" />
              {language.toUpperCase()}
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {languageOpen && (
              <div className="absolute right-0 top-12 z-50 w-44 rounded-2xl border border-slate-200 bg-white p-2 text-sm shadow-xl">
                <p className="px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">{t('language')}</p>
                {(['vi', 'en'] as const).map((option) => (
                  <button key={option} type="button" onClick={() => handleLanguageChange(option)} className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-slate-700 hover:bg-slate-50">
                    {option === 'vi' ? 'Tiếng Việt' : 'English'}
                    {language === option && <span aria-hidden="true">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {session ? (
            <div className="flex items-center gap-3">
              <div className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 md:inline-flex">
                {session.user.name}
              </div>
              <button type="button" onClick={handleLogout} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                <LogOut className="h-4 w-4" />
                {t('logout')}
              </button>
            </div>
          ) : (
            <Link href="/login" className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-slate-900/10 transition hover:bg-slate-800">
              <User className="h-4 w-4" />
              {t('login')}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
