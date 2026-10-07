'use client';
import { useEffect } from 'react';

// Supports Supabase's default confirmation email without exposing tokens to storage.
export function EmailSession() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (params.has('error_code')) {
      window.history.replaceState(null, '', window.location.pathname);
      window.location.replace(params.get('type') === 'recovery' || window.location.pathname === '/auth/recovery' ? '/reset-password?verification=failed' : '/sign-in?verification=failed');
      return;
    }
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (!access_token || !refresh_token) return;
    // Remove credentials from the address bar before performing any requests.
    window.history.replaceState(null, '', window.location.pathname);
    const recovery = params.get('type') === 'recovery';
    const failed = recovery ? '/reset-password?verification=failed' : '/sign-in?verification=failed';
    fetch('/api/auth/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token, refresh_token, ...(recovery ? { type: 'recovery' } : {}) }) })
      .then(async response => { const data = await response.json(); window.location.replace(response.ok ? data.destination : failed); })
      .catch(() => window.location.replace(failed));
  }, []);
  return null;
}
