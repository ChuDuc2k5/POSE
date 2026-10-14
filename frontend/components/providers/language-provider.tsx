'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { getAuthSession, saveAuthSession } from '@/lib/auth-client';
import { getLanguageFromStorage, setLanguagePreference, t as translate, type SupportedLanguage } from '@/lib/i18n';

type LanguageContextValue = {
  language: SupportedLanguage;
  setLanguage: (language: SupportedLanguage) => void;
  t: (key: Parameters<typeof translate>[0]) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<SupportedLanguage>('vi');

  useEffect(() => {
    const syncLanguage = () => setLanguageState(getLanguageFromStorage());
    syncLanguage();
    window.addEventListener('revoland-language-change', syncLanguage);
    return () => window.removeEventListener('revoland-language-change', syncLanguage);
  }, []);

  const setLanguage = (nextLanguage: SupportedLanguage) => {
    setLanguageState(nextLanguage);
    setLanguagePreference(nextLanguage);
    const session = getAuthSession();
    if (session) {
      saveAuthSession({ ...session, user: { ...session.user, language: nextLanguage } });
      void fetch('/api/users/me/preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ language: nextLanguage }),
      }).catch(() => undefined);
    }
    window.dispatchEvent(new Event('revoland-language-change'));
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t: (key) => translate(key, language) }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
}
