import viMessages from '../locales/vi/common.json';
import enMessages from '../locales/en/common.json';

export type SupportedLanguage = 'vi' | 'en';

const translations = {
  vi: viMessages,
  en: enMessages,
} as const;

export function getLanguageFromStorage(): SupportedLanguage {
  if (typeof window === 'undefined') return 'vi';
  const saved = window.localStorage.getItem('revoland-language');
  return saved === 'en' ? 'en' : 'vi';
}

export function setLanguagePreference(language: SupportedLanguage) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem('revoland-language', language);
}

export function t(key: keyof typeof viMessages, language: SupportedLanguage = getLanguageFromStorage()) {
  return translations[language][key] ?? translations.vi[key];
}
