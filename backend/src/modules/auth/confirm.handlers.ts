import { WebRequest, WebResponse } from '../../common/http.js';
import { authClient, authenticatedSession, saveSession } from './session.js';
import { signedInHome } from '../../common/roles.js';
import { beginRecovery } from '../account/account.service.js';

export async function GET(request: WebRequest) {
  const token_hash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type');
  try {
    if (token_hash && token_hash.length <= 1024 && (type === 'email' || type === 'recovery')) {
      const { data, error } = await authClient().auth.verifyOtp({ token_hash, type });
      if (!error && data.session && data.user?.email_confirmed_at) {
        if (type === 'recovery') await beginRecovery(data.session);
        else await saveSession(data.session);
        const session = type === 'recovery' ? null : await authenticatedSession();
        const response = WebResponse.redirect(
          new URL(type === 'recovery' ? '/reset-password' : session ? signedInHome : '/sign-in', request.url),
        );
        response.headers.set('Cache-Control', 'no-store');
        response.headers.set('Referrer-Policy', 'no-referrer');
        return response;
      }
    }
  } catch {
    /* Never expose provider errors or tokens. */
  }
  const response = WebResponse.redirect(
    new URL(type === 'recovery' ? '/reset-password?verification=failed' : '/sign-in?verification=failed', request.url),
  );
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
