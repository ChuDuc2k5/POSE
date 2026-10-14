export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  language: 'vi' | 'en';
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

const STORAGE_KEY = 'revoland-auth';

export function saveAuthSession(session: AuthSession | null) {
  if (typeof window === 'undefined') return;
  if (!session) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function getAuthSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export function clearAuthSession() {
  saveAuthSession(null);
}
