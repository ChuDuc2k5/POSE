import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { cookies, currentClientIp, validOrigin, WebRequest, WebResponse } from '../../common/http.js';
import { clearRecovery } from '../account/account.service.js';
import { roleHome } from '../../common/roles.js';
import { authenticatedSession, consumeAttempt, saveSession, verifyAccessSession } from './session.js';
import { ensureGoogleProfile } from './google-profile.js';

const FLOW_COOKIE = 'pose-google-flow';
const STORAGE_KEY = 'pose-google';
const FLOW_SECONDS = 600;
const ephemeralSecret = randomBytes(32).toString('hex');
type Flow = { verifier: string; issuedAt: number; next: string };

function signature(value: string) {
  const configured = process.env.GOOGLE_OAUTH_STATE_SECRET;
  if (configured && configured.length < 32) throw new Error('OAUTH_SECRET_TOO_SHORT');
  return createHmac('sha256', configured || ephemeralSecret).update(value).digest('base64url');
}
function encodeFlow(flow: Flow) {
  const value = Buffer.from(JSON.stringify(flow)).toString('base64url');
  return `${value}.${signature(value)}`;
}
function decodeFlow(value: string | undefined): Flow | null {
  if (!value || value.length > 2048) return null;
  try {
    const [payload, mac, extra] = value.split('.');
    if (!payload || !mac || extra !== undefined) return null;
    const expected = Buffer.from(signature(payload)), received = Buffer.from(mac);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    const flow = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Flow;
    const age = Date.now() - flow.issuedAt;
    if (!Number.isSafeInteger(flow.issuedAt) || age < 0 || age > FLOW_SECONDS * 1000 ||
        typeof flow.verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(flow.verifier) ||
        !['', '/customer/inquiries/new'].includes(flow.next)) return null;
    return flow;
  } catch { return null; }
}

// Each SDK instance and its storage belong to one HTTP request. Only the signed
// PKCE transaction crosses requests; SDK sessions are never written to cookies.
function googleClient(verifier?: string) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('AUTH_NOT_CONFIGURED');
  const storage = new Map<string, string>();
  if (verifier) storage.set(`${STORAGE_KEY}-code-verifier`, JSON.stringify(verifier));
  const client = createClient(url, key, {
    auth: {
      flowType: 'pkce', storageKey: STORAGE_KEY, persistSession: true,
      autoRefreshToken: false, detectSessionInUrl: false,
      storage: {
        getItem: (name: string) => storage.get(name) ?? null,
        setItem: (name: string, value: string) => { storage.set(name, value); },
        removeItem: (name: string) => { storage.delete(name); },
      },
    },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) },
  });
  return { client, verifier: () => {
    const stored = storage.get(`${STORAGE_KEY}-code-verifier`);
    return stored ? JSON.parse(stored) as string : null;
  } };
}

const json = (body: object, status = 200) => WebResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
function finish(request: WebRequest, destination: string) {
  const response = WebResponse.redirect(new URL(destination, request.nextUrl.origin), 303);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function START(request: WebRequest) {
  if (!validOrigin(request)) return json({ message: 'Yêu cầu không hợp lệ.' }, 403);
  try {
    if (Number(request.headers.get('content-length')) > 1024) return json({ message: 'Dữ liệu quá lớn.' }, 413);
    const raw = await request.text();
    if (raw.length > 1024) return json({ message: 'Dữ liệu quá lớn.' }, 413);
    let input: Record<string, unknown>;
    try { input = JSON.parse(raw); } catch { return json({ message: 'Dữ liệu không hợp lệ.' }, 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(key => !['acceptTerms', 'next'].includes(key)) || input.acceptTerms !== true ||
        (input.next !== undefined && !['', '/customer/inquiries/new'].includes(input.next as string))) {
      return json({ message: 'Vui lòng đồng ý điều khoản trước khi tiếp tục với Google.' }, 400);
    }
    const existing = await authenticatedSession();
    if (existing) return json({ url: roleHome(existing.role) });
    if (!consumeAttempt('google-start', currentClientIp(), 30)) {
      return json({ message: 'Bạn đã thử đăng nhập Google quá nhiều lần. Vui lòng thử lại sau 15 phút.' }, 429);
    }
    const settingsResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY || '' },
      signal: AbortSignal.timeout(10000), cache: 'no-store',
    });
    const settings = await settingsResponse.json() as { external?: { google?: boolean } };
    if (!settingsResponse.ok || settings.external?.google !== true) {
      return json({ message: 'Đăng nhập Google tạm thời chưa khả dụng. Bạn có thể dùng email và mật khẩu.' }, 503);
    }
    const sdk = googleClient();
    const { data, error } = await sdk.client.auth.signInWithOAuth({
      provider: 'google', options: {
        redirectTo: `${request.nextUrl.origin}/api/auth/google/callback`,
        skipBrowserRedirect: true, queryParams: { prompt: 'select_account' },
      },
    });
    const verifier = sdk.verifier();
    if (error || !data.url || !verifier) throw new Error('OAUTH_START_FAILED');
    const jar = await cookies();
    jar.set(FLOW_COOKIE, encodeFlow({ verifier, issuedAt: Date.now(), next: input.next as string || '' }), {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: FLOW_SECONDS,
    });
    return json({ url: data.url });
  } catch { return json({ message: 'Chưa thể kết nối Google. Vui lòng thử lại hoặc đăng nhập bằng email.' }, 503); }
}

export async function CALLBACK(request: WebRequest) {
  const jar = await cookies();
  const flow = decodeFlow(jar.get(FLOW_COOKIE)?.value);
  jar.delete(FLOW_COOKIE);
  if (!flow) return finish(request, '/sign-in?oauth=expired');
  if (request.nextUrl.searchParams.has('error')) return finish(request, '/sign-in?oauth=cancelled');
  const code = request.nextUrl.searchParams.get('code');
  if (!code || code.length > 4096 || request.nextUrl.searchParams.getAll('code').length !== 1) {
    return finish(request, '/sign-in?oauth=failed');
  }
  if (!consumeAttempt('google-callback', signature(flow.verifier), 5)) return finish(request, '/sign-in?oauth=expired');
  try {
    const { data, error } = await googleClient(flow.verifier).client.auth.exchangeCodeForSession(code);
    if (error || !data.session || !data.user?.email || !data.user.email_confirmed_at) return finish(request, '/sign-in?oauth=failed');
    const session = await verifyAccessSession(data.session.access_token);
    if (!session || session.user.id !== data.user.id) return finish(request, '/sign-in?oauth=unavailable');
    await ensureGoogleProfile(session.access, session.user);
    await clearRecovery();
    await saveSession(data.session);
    const destination = session.role === 'User' && flow.next ? flow.next : roleHome(session.role);
    return finish(request, destination);
  } catch { return finish(request, '/sign-in?oauth=failed'); }
}
