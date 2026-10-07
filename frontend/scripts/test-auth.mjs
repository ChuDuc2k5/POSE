import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';

// Integration tests use an isolated provider fixture; never send real email.
let revoked = false;
let accessRole = 'User';
let accountActive = true;
let providerOffline = false;
let recoveryState = 'None';
let currentPassword = 'safe-password-123';
const usedLinks = new Set();
const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', email: 'fixture@example.test', email_confirmed_at: '2026-10-04T00:00:00Z', app_metadata: {}, user_metadata: { display_name: 'Khách thử nghiệm' }, created_at: '2026-10-04T00:00:00Z' };
let profile = { name: 'Khách thử nghiệm', phone: '', phoneVerified: false, notificationsEnabled: true, avatarPath: null, version: 0, updatedAt: null };
const history = [];
const avatar = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#12665e' } }).png().toBuffer();
const session = () => ({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, user });
const provider = createServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk;
  const input = raw && request.headers['content-type']?.includes('application/json') ? JSON.parse(raw) : {};
  const url = new URL(request.url, 'http://localhost');
  response.setHeader('Content-Type', 'application/json');
  const reply = (status, body) => { response.writeHead(status); response.end(JSON.stringify(body)); };
  if (providerOffline) return reply(503, { msg: 'Unavailable' });
  if (url.pathname.endsWith('/rpc/pose_access_context')) return reply(200, { user_id: user.id, role: accessRole, active: accountActive, session_valid: !revoked });
  if (url.pathname.endsWith('/rpc/pose_read_profile')) return reply(200, profile);
  if (url.pathname.endsWith('/rpc/pose_update_profile')) {
    if (input.p_version !== profile.version) return reply(409, { code: '40001', message: 'PROFILE_CONFLICT' });
    profile = { ...profile, ...(input.p_changes.name ? { name: input.p_changes.name } : {}), ...(input.p_changes.phone !== undefined ? { phone: input.p_changes.phone, phoneVerified: false } : {}), ...(input.p_changes.notificationsEnabled !== undefined ? { notificationsEnabled: input.p_changes.notificationsEnabled } : {}), ...(input.p_changes.avatarPath ? { avatarPath: input.p_changes.avatarPath } : {}), version: profile.version + 1 };
    history.unshift({ id: String(history.length), action: 'profile_updated', changed_fields: Object.keys(input.p_changes), created_at: new Date().toISOString() });
    return reply(200, profile);
  }
  if (url.pathname.endsWith('/rpc/pose_record_phone_verification')) {
    profile = { ...profile, phoneVerified: true, version: profile.version + 1 };
    return reply(200, profile);
  }
  if (url.pathname.endsWith('/account_history')) return reply(200, history);
  if (url.pathname.endsWith('/rpc/pose_recovery_ticket')) {
    if (input.p_action === 'begin' && recoveryState === 'None') recoveryState = 'Pending';
    if (input.p_action === 'claim') { const valid = recoveryState === 'Pending'; if (valid) recoveryState = 'Processing'; return reply(200, valid); }
    if (input.p_action === 'finish') { const valid = recoveryState === 'Processing'; if (valid) { recoveryState = 'Completed'; revoked = true; } return reply(200, valid); }
    return reply(200, recoveryState === 'Pending');
  }
  if (url.pathname.includes('/storage/v1/object/sign/')) {
    if (request.method === 'POST') return reply(200, { signedURL: '/object/sign/account-avatars/fixture.png?token=fixture' });
    response.setHeader('Content-Type', 'image/png'); response.writeHead(200); return response.end(avatar);
  }
  if (url.pathname.includes('/storage/v1/object/')) return reply(200, { Key: 'fixture.png' });
  if (url.pathname.endsWith('/recover')) return input.email === user.email ? reply(200, {}) : reply(400, { msg: 'Unknown email' });
  if (url.pathname.endsWith('/settings')) return reply(200, { mailer_autoconfirm: false, external: { email: true } });
  if (url.pathname.endsWith('/signup')) return reply(200, { ...user, email_confirmed_at: null });
  if (url.pathname.endsWith('/resend')) return reply(200, {});
  if (url.pathname.endsWith('/token')) {
    if (url.searchParams.get('grant_type') === 'password' && input.password === currentPassword) { revoked = false; return reply(200, session()); }
    if (url.searchParams.get('grant_type') === 'refresh_token' && input.refresh_token === 'fixture-refresh' && !revoked) return reply(200, session());
    return reply(400, { code: 'invalid_credentials', msg: 'Invalid login credentials' });
  }
  if (url.pathname.endsWith('/user')) {
    if (request.headers.authorization !== 'Bearer fixture-access' || revoked) return reply(401, { msg: 'Invalid token' });
    if (request.method === 'PUT') { if (input.password) currentPassword = input.password; if (input.phone) user.phone_change = input.phone; }
    return reply(200, user);
  }
  if (url.pathname.endsWith('/logout')) { revoked = true; response.writeHead(204); return response.end(); }
  if (url.pathname.endsWith('/verify')) {
    if (input.type === 'phone_change' && input.token === '123456' && !usedLinks.has('phone-otp')) {
      usedLinks.add('phone-otp'); user.phone = user.phone_change; user.phone_confirmed_at = new Date().toISOString(); return reply(200, session());
    }
    if (['valid-once','recovery-once'].includes(input.token_hash) && !usedLinks.has(input.token_hash)) {
      usedLinks.add(input.token_hash); revoked = false; return reply(200, session());
    }
    return reply(403, { msg: 'Token expired' });
  }
  return reply(404, {});
});
await new Promise(resolve => provider.listen(3211, '127.0.0.1', resolve));
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--port', '3210'], { cwd: new URL('..', import.meta.url), env: { ...process.env, SUPABASE_URL: 'http://127.0.0.1:3211', SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let startupOutput = '';
app.stdout.on('data', chunk => { startupOutput += chunk; });
app.stderr.on('data', chunk => { startupOutput += chunk; });
const origin = 'http://localhost:3210';
const post = (action, body, cookie, requestOrigin = origin) => fetch(`${origin}/api/auth/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body ?? {}) });
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
try {
  let ready = false;
  for (let i = 0; i < 40; i++) { try { const r = await fetch(origin); if (r.ok) { ready = true; break; } } catch {} await delay(250); }
  assert.ok(ready, `Test app did not start: ${startupOutput}`);
  const valid = { email: 'fixture@example.test', password: 'safe-password-123', confirmPassword: 'safe-password-123', name: 'Khách thử nghiệm', acceptTerms: true };
  for (const path of ['/', '/sign-in', '/sign-up']) check((await fetch(`${origin}${path}`, { redirect: 'manual' })).status === 200, `Guest can open ${path}`);
  check((await fetch(`${origin}/api/auth/me`)).status === 401, 'Anonymous profile must be blocked');
  check((await post('signin', valid, undefined, 'https://other.example')).status === 403, 'Cross-origin login must be blocked');
  check((await post('signup', { ...valid, role: 'Admin' })).status === 400, 'Public signup must reject role escalation');
  check((await post('signup', { ...valid, password: 'short' })).status === 400, 'Short password must be rejected');
  check((await post('signup', { ...valid, acceptTerms: false })).status === 400, 'Terms must be explicit');
  const signup = await post('signup', valid);
  check(signup.status === 200 && signup.headers.getSetCookie().length === 0, 'Unverified signup must not create a browser session');
  check((await post('resend', { email: valid.email })).status === 200, 'Resend must work without revealing account existence');
  const signin = await post('signin', valid);
  check(signin.status === 200, 'Valid credentials must sign in');
  check((await signin.json()).destination === '/customer', 'Customer login returns to the homepage');
  const setCookies = signin.headers.getSetCookie();
  const sessionCookies = setCookies.filter(c => /^pose-(access|refresh)=fixture/.test(c));
  check(sessionCookies.length === 2 && sessionCookies.every(c => /HttpOnly/i.test(c) && /SameSite=lax/i.test(c)), 'Session cookies must be HttpOnly and SameSite');
  const cookie = sessionCookies.map(c => c.split(';')[0]).join('; ');
  const me = await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie } });
  check(me.status === 200 && (await me.json()).user.name === user.user_metadata.display_name, 'Profile must be fetched from verified provider identity');
  check(me.headers.get('cache-control') === 'no-store', 'Profile must not be cached');
  const protectedPage = path => fetch(`${origin}${path}`, { headers: { Cookie: cookie }, redirect: 'manual' });
  const checkGuestEntryRedirects = async destination => {
    for (const path of ['/', '/sign-in', '/sign-up']) {
      const response = await protectedPage(path);
      check(response.status === 307 && response.headers.get('location') === destination, `Signed-in ${accessRole} entering ${path} opens ${destination}`);
      check(!(await response.text()).includes('Thông tin rõ ràng.'), 'Signed-in guest entry must not render landing content');
    }
  };
  await checkGuestEntryRedirects('/customer');
  for (const path of ['/customer','/customer/favorites','/customer/inquiries','/customer/inquiries/new','/properties']) {
    const header = (await (await protectedPage(path)).text()).match(/<header\b[\s\S]*?<\/header>/)?.[0] || '';
    check(header.includes('Hồ sơ cá nhân') && header.includes('Đăng xuất') && !header.includes('href="/sign-in"') && !header.includes('href="/sign-up"'), `First HTML of ${path} already contains the signed-in header`);
  }
  const refreshOnly = { Cookie: 'pose-refresh=fixture-refresh' };
  check((await fetch(origin, { headers: refreshOnly, redirect: 'manual' })).headers.get('location') === '/auth/refresh?next=%2F', 'Expired access on landing renews through the writable handler');
  for (const path of ['/', '/sign-in', '/sign-up']) check((await fetch(`${origin}/auth/refresh?next=${encodeURIComponent(path)}`, { headers: refreshOnly, redirect: 'manual' })).headers.get('location') === `${origin}/customer`, 'Refreshed guest entry opens role home directly');
  const invalidRefresh = await fetch(`${origin}/auth/refresh?next=%2F`, { headers: { Cookie: 'pose-refresh=expired' }, redirect: 'manual' });
  check(invalidRefresh.headers.get('location') === `${origin}/` && invalidRefresh.headers.getSetCookie().some(c=>c.startsWith('pose-refresh=;')), 'Invalid refresh returns to guest landing and clears the stale cookie');
  check((await fetch(`${origin}/auth/refresh?next=https://evil.example`, { headers: refreshOnly, redirect: 'manual' })).headers.get('location') === `${origin}/customer`, 'Refresh cannot redirect to an external destination');
  const catalogNext = '/properties?type=Apartment&minPrice=3000000000';
  check((await fetch(`${origin}/auth/refresh?next=${encodeURIComponent(catalogNext)}`, { headers: refreshOnly, redirect: 'manual' })).headers.get('location') === `${origin}${catalogNext}`, 'Catalog refresh preserves the active filters');
  check((await fetch(`${origin}/auth/refresh?next=${encodeURIComponent(catalogNext)}`, { headers: {Cookie:'pose-refresh=expired'}, redirect:'manual' })).headers.get('location') === `${origin}${catalogNext}`, 'Invalid catalog refresh returns to the public page without a loop');
  check((await fetch(`${origin}/auth/refresh?next=${encodeURIComponent('/properties/../../evil')}`, { headers: refreshOnly, redirect:'manual' })).headers.get('location') === `${origin}/customer`, 'Catalog refresh rejects path traversal');
  check((await fetch(`${origin}/customer`, { redirect: 'manual' })).headers.get('location')?.endsWith('/sign-in'), 'Customer homepage requires login');
  check((await protectedPage('/customer')).status === 200, 'Customer can open their homepage');
  check((await (await post('session', { access_token: 'fixture-access', refresh_token: 'fixture-refresh' })).json()).destination === '/customer', 'Email session callback opens customer homepage');
  const verified = await fetch(`${origin}/auth/confirm?token_hash=valid-once&type=email`, { redirect: 'manual' });
  check(verified.headers.get('location') === `${origin}/customer`, 'Verified email opens customer homepage');
  check((await fetch(`${origin}/account`, { redirect: 'manual' })).status === 307, 'Account page must be protected on the server');
  check((await protectedPage('/admin')).headers.get('location')?.endsWith('/forbidden'), 'User must not open admin page directly');
  check((await protectedPage('/sales')).headers.get('location')?.endsWith('/forbidden'), 'User must not open sales page directly');
  check((await fetch(`${origin}/api/workspace/admin`, { headers: { Cookie: cookie } })).status === 403, 'User must not access admin BFF');
  check((await fetch(`${origin}/api/workspace/sales`)).status === 401, 'Anonymous workspace API must be denied');
  user.user_metadata.role = 'Admin';
  check((await protectedPage('/')).headers.get('location') === '/customer', 'Guest entry ignores forged user metadata role');
  check((await protectedPage('/admin')).headers.get('location')?.endsWith('/forbidden'), 'Editable metadata must not grant Admin');
  accessRole = 'Sales';
  await checkGuestEntryRedirects('/sales');
  check((await protectedPage('/customer')).headers.get('location')?.endsWith('/forbidden'), 'Sales cannot open customer-only homepage');
  check((await (await post('signin',valid)).json()).destination === '/sales', 'Sales login returns to the homepage');
  check((await protectedPage('/sales')).status === 200, 'Sales can open sales page');
  check((await protectedPage('/admin')).headers.get('location')?.endsWith('/forbidden'), 'Sales cannot open admin page');
  accessRole = 'Admin';
  await checkGuestEntryRedirects('/admin');
  check((await (await post('signin',valid)).json()).destination === '/admin', 'Admin login returns to the homepage');
  check((await protectedPage('/admin')).status === 200, 'Admin can open admin page');
  accessRole = 'User';
  check((await protectedPage('/admin')).headers.get('location')?.endsWith('/forbidden'), 'Role downgrade must take effect immediately');
  const refreshed = await fetch(`${origin}/api/auth/me`, { headers: { Cookie: 'pose-refresh=fixture-refresh' } });
  check(refreshed.status === 200 && refreshed.headers.getSetCookie().length === 2, 'Expired access cookie must refresh and rotate browser cookies');
  const refreshRedirect = await fetch(`${origin}/account`, { headers: { Cookie: 'pose-refresh=fixture-refresh' }, redirect: 'manual' });
  check(refreshRedirect.headers.get('location')?.includes('/auth/refresh?next='), 'SSR refresh must use a writable route handler');
  const safeRedirect = await fetch(`${origin}/auth/refresh?next=https://evil.example`, { headers: { Cookie: cookie }, redirect: 'manual' });
  check(safeRedirect.headers.get('location') === `${origin}/customer`, 'Refresh must reject open redirects and fall back to homepage');
  providerOffline = true;
  const unavailable = await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie } });
  check(unavailable.status === 503 && unavailable.headers.getSetCookie().length === 0, 'Provider outages must not destroy cookies');
  providerOffline = false;
  accountActive = false;
  check((await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie } })).status === 401, 'Suspended account must lose access');
  accountActive = true;
  check((await post('session', { access_token: 'forged', refresh_token: 'fixture-refresh' })).status === 401, 'Callback must reject forged access token');
  const expired = await fetch(`${origin}/auth/confirm?token_hash=expired&type=email`, { redirect: 'manual' });
  check(expired.status === 307 && expired.headers.get('location').endsWith('/sign-in?verification=failed'), 'Expired verification must show recovery flow');
  const logout = await post('logout', {}, cookie);
  check(logout.status === 200 && logout.headers.getSetCookie().some(c => c.startsWith('pose-access=;')), 'Logout must revoke provider session and clear cookies');
  check((await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie } })).status === 401, 'Revoked session must be rejected');
  check((await protectedPage('/')).headers.get('location')?.startsWith('/auth/refresh?'), 'Revoked access with stale refresh is checked instead of reopening a role home');
  const revokedRefresh = await fetch(`${origin}/auth/refresh?next=%2F`, { headers: { Cookie: cookie }, redirect: 'manual' });
  check(revokedRefresh.headers.get('location') === `${origin}/`, 'Revoked refresh returns to guest landing');
  check((await fetch(origin, { redirect: 'manual' })).status === 200, 'Landing is available after logout');
  for (let i = 0; i < 5; i++) check((await post('signin', { email: 'wrong@example.test', password: 'incorrect' })).status === 401, 'Incorrect password must not grant a session');
  check((await post('signin', { email: 'wrong@example.test', password: 'incorrect' })).status === 429, 'Sixth incorrect attempt must be limited');
  // Profile and recovery flows exercise production route handlers, not helpers.
  await post('signin', valid);
  const profileRequest = (body, cookies = cookie, requestOrigin = origin) => fetch(`${origin}/api/account/profile`, { method: 'PATCH', headers: { Cookie: cookies, Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const profileInput = { name: 'Khách cập nhật', phone: '0912345678', notificationsEnabled: false, version: 0 };
  check((await profileRequest(profileInput, '')).status === 401, 'Anonymous profile edits denied');
  check((await profileRequest(profileInput, cookie, 'https://evil.example')).status === 403, 'Cross-origin profile edits denied');
  for (const forbidden of ['role','user_id','phoneVerified','account_status']) check((await profileRequest({ ...profileInput, [forbidden]: 'forged' })).status === 400, 'Privilege/ownership fields denied');
  const updatedProfile = await profileRequest(profileInput);
  check(updatedProfile.status === 200 && (await updatedProfile.json()).profile.phone === '+84912345678', 'Profile edit normalizes phone');
  check((await profileRequest(profileInput)).status === 409, 'Stale edits must not overwrite current profile');
  check((await (await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie } })).json()).user.name === profileInput.name, 'Current name displayed after profile edit');
  const phonePost = (action, body) => fetch(`${origin}/api/account/phone/${action}`, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  check((await phonePost('send', {})).status === 200, 'Phone OTP can be requested for saved number');
  check((await phonePost('verify', { token: '000000' })).status === 400, 'Wrong phone OTP denied');
  const phoneVerified = await phonePost('verify', { token: '123456' });
  check(phoneVerified.status === 200 && (await phoneVerified.json()).profile.phoneVerified, 'Phone marked verified only after provider verification');
  check((await profileRequest({ ...profileInput, phone: '0987654321', version: profile.version })).status === 200 && !profile.phoneVerified, 'Changing number clears verified status');
  const avatarPost = (file) => { const form = new FormData(); form.set('file', file); form.set('version', String(profile.version)); return fetch(`${origin}/api/account/avatar`, { method: 'POST', headers: { Origin: origin, Cookie: cookie }, body: form }); };
  check((await avatarPost(new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' }))).status === 400, 'SVG avatar denied');
  check((await avatarPost(new File(['not-a-png'], 'bad.png', { type: 'image/png' }))).status === 400, 'Fake image MIME denied');
  check((await avatarPost(new File([avatar], 'valid.png', { type: 'image/png' }))).status === 200, 'Valid avatar decoded and stored');
  const knownRecovery = await post('forgot-password', { email: user.email });
  const unknownRecovery = await post('forgot-password', { email: 'nobody@example.test' });
  check(knownRecovery.status === 200 && unknownRecovery.status === 200 && (await knownRecovery.json()).message === (await unknownRecovery.json()).message, 'Recovery must not reveal whether email exists');
  check((await post('reset-password', { password: 'new-safe-password-123', confirmPassword: 'new-safe-password-123' }, cookie)).status === 401, 'Ordinary login cookie alone does not authorize password recovery');
  const failedRecovery = await fetch(`${origin}/auth/confirm?token_hash=expired&type=recovery`, { redirect: 'manual' });
  check(failedRecovery.headers.get('location')?.endsWith('/reset-password?verification=failed'), 'Expired recovery link rejected');
  const recovery = await fetch(`${origin}/auth/confirm?token_hash=recovery-once&type=recovery`, { redirect: 'manual' });
  check(recovery.status === 307 && recovery.headers.get('location')?.endsWith('/reset-password'), 'Verified recovery link opens reset page');
  const recoveryCookies = recovery.headers.getSetCookie().filter(c => /^pose-recovery-(access|refresh)=fixture/.test(c));
  check(recoveryCookies.length === 2 && recoveryCookies.every(c => /HttpOnly/i.test(c)), 'Recovery credentials stay in HttpOnly cookies');
  const recoveryCookie = recoveryCookies.map(c => c.split(';')[0]).join('; ');
  check((await post('reset-password', { password: 'short', confirmPassword: 'short' }, recoveryCookie)).status === 400, 'Weak password denied before consuming link');
  const reset = await post('reset-password', { password: 'new-safe-password-123', confirmPassword: 'new-safe-password-123' }, recoveryCookie);
  check(reset.status === 200 && currentPassword === 'new-safe-password-123', 'Recovery changes password');
  check((await post('reset-password', { password: 'new-safe-password-456', confirmPassword: 'new-safe-password-456' }, recoveryCookie)).status === 401, 'Recovery credential cannot be reused');
  check((await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie } })).status === 401, 'Password reset revokes older sessions');
  check((await fetch(`${origin}/auth/confirm?token_hash=recovery-once&type=recovery`, { redirect: 'manual' })).headers.get('location')?.includes('verification=failed'), 'Used recovery email token denied');
  check((await post('signin', valid)).status === 401, 'Old password rejected after reset');
  check((await post('signin', { ...valid, password: currentPassword })).status === 200, 'New password signs in');
  console.log(`PASS: ${checks} auth integration checks; no real user/email created.`);
  if (process.argv.includes('--preview')) {
    currentPassword = valid.password; revoked = false;
    console.log(`PREVIEW READY: ${origin}; fixture@example.test / safe-password-123 (fake provider only).`);
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  }
} finally {
  app.kill();
  provider.close();
}
