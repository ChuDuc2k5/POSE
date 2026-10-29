import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startStack } from './test-stack.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { createHash } from 'node:crypto';

// Integration tests use an isolated provider fixture; never send real email.
let revoked = false;
let accessRole = 'User';
let accountActive = true;
let providerOffline = false;
let recoveryState = 'None';
let currentPassword = 'safe-password-123';
const usedLinks = new Set();
let oauthChallenge = '';
const usedOAuthCodes = new Set();
const user = {
  id: '00000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  email: 'fixture@example.test',
  email_confirmed_at: '2026-10-04T00:00:00Z',
  app_metadata: {},
  user_metadata: { display_name: 'Khách thử nghiệm' },
  created_at: '2026-10-04T00:00:00Z',
};
let profile = {
  name: 'Khách thử nghiệm',
  phone: '',
  phoneVerified: false,
  notificationsEnabled: true,
  avatarPath: null,
  version: 0,
  updatedAt: null,
};
const history = [];
const avatar = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#12665e' } })
  .png()
  .toBuffer();
const session = () => ({
  access_token: 'fixture-access',
  refresh_token: 'fixture-refresh',
  token_type: 'bearer',
  expires_in: 3600,
  user,
});
const provider = createServer(async (request, response) => {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const input = raw && request.headers['content-type']?.includes('application/json') ? JSON.parse(raw) : {};
  const url = new URL(request.url, 'http://localhost');
  response.setHeader('Content-Type', 'application/json');
  const reply = (status, body) => {
    response.writeHead(status);
    response.end(JSON.stringify(body));
  };
  if (providerOffline) return reply(503, { msg: 'Unavailable' });
  if (url.pathname.endsWith('/rpc/pose_access_context'))
    return reply(200, { user_id: user.id, role: accessRole, active: accountActive, session_valid: !revoked });
  if (url.pathname.endsWith('/rpc/pose_read_profile')) return reply(200, profile);
  if (url.pathname.endsWith('/account_profiles')) return reply(200, [{ user_id: user.id }]);
  if (url.pathname.endsWith('/rpc/pose_update_profile')) {
    if (input.p_version !== profile.version) return reply(409, { code: '40001', message: 'PROFILE_CONFLICT' });
    profile = {
      ...profile,
      ...(input.p_changes.name ? { name: input.p_changes.name } : {}),
      ...(input.p_changes.phone !== undefined ? { phone: input.p_changes.phone, phoneVerified: false } : {}),
      ...(input.p_changes.notificationsEnabled !== undefined
        ? { notificationsEnabled: input.p_changes.notificationsEnabled }
        : {}),
      ...(input.p_changes.avatarPath ? { avatarPath: input.p_changes.avatarPath } : {}),
      version: profile.version + 1,
    };
    history.unshift({
      id: String(history.length),
      action: 'profile_updated',
      changed_fields: Object.keys(input.p_changes),
      created_at: new Date().toISOString(),
    });
    return reply(200, profile);
  }
  if (url.pathname.endsWith('/rpc/pose_record_phone_verification')) {
    profile = { ...profile, phoneVerified: true, version: profile.version + 1 };
    return reply(200, profile);
  }
  if (url.pathname.endsWith('/account_history')) return reply(200, history);
  if (url.pathname.endsWith('/rpc/pose_recovery_ticket')) {
    if (input.p_action === 'begin' && recoveryState === 'None') recoveryState = 'Pending';
    if (input.p_action === 'claim') {
      const valid = recoveryState === 'Pending';
      if (valid) recoveryState = 'Processing';
      return reply(200, valid);
    }
    if (input.p_action === 'finish') {
      const valid = recoveryState === 'Processing';
      if (valid) {
        recoveryState = 'Completed';
        revoked = true;
      }
      return reply(200, valid);
    }
    return reply(200, recoveryState === 'Pending');
  }
  if (url.pathname.includes('/storage/v1/object/sign/')) {
    if (request.method === 'POST')
      return reply(200, { signedURL: '/object/sign/account-avatars/fixture.png?token=fixture' });
    response.setHeader('Content-Type', 'image/png');
    response.writeHead(200);
    return response.end(avatar);
  }
  if (url.pathname.includes('/storage/v1/object/')) return reply(200, { Key: 'fixture.png' });
  if (url.pathname.endsWith('/recover'))
    return input.email === user.email ? reply(200, {}) : reply(400, { msg: 'Unknown email' });
  if (url.pathname.endsWith('/settings'))
    return reply(200, { mailer_autoconfirm: false, external: { email: true, google: true } });
  if (url.pathname.endsWith('/authorize') && url.searchParams.get('provider') === 'google') {
    oauthChallenge = url.searchParams.get('code_challenge');
    response.writeHead(302, { Location: `${url.searchParams.get('redirect_to')}?code=oauth-once` });
    return response.end();
  }
  if (url.pathname.endsWith('/signup')) return reply(200, { ...user, email_confirmed_at: null });
  if (url.pathname.endsWith('/resend')) return reply(200, {});
  if (url.pathname.endsWith('/token')) {
    if (
      url.searchParams.get('grant_type') === 'pkce' &&
      input.auth_code === 'oauth-once' &&
      !usedOAuthCodes.has(input.auth_code) &&
      createHash('sha256')
        .update(input.code_verifier || '')
        .digest('base64url') === oauthChallenge
    ) {
      usedOAuthCodes.add(input.auth_code);
      revoked = false;
      user.identities = [{ provider: 'google', id: 'fixture-google' }];
      return reply(200, session());
    }
    if (url.searchParams.get('grant_type') === 'password' && input.password === currentPassword) {
      revoked = false;
      return reply(200, session());
    }
    if (url.searchParams.get('grant_type') === 'refresh_token' && input.refresh_token === 'fixture-refresh' && !revoked)
      return reply(200, session());
    return reply(400, { code: 'invalid_credentials', msg: 'Invalid login credentials' });
  }
  if (url.pathname.endsWith('/user')) {
    if (request.headers.authorization !== 'Bearer fixture-access' || revoked)
      return reply(401, { msg: 'Invalid token' });
    if (request.method === 'PUT') {
      if (input.password) currentPassword = input.password;
      if (input.phone) user.phone_change = input.phone;
    }
    return reply(200, user);
  }
  if (url.pathname.endsWith('/logout')) {
    revoked = true;
    response.writeHead(204);
    return response.end();
  }
  if (url.pathname.endsWith('/verify')) {
    if (input.type === 'phone_change' && input.token === '123456' && !usedLinks.has('phone-otp')) {
      usedLinks.add('phone-otp');
      user.phone = user.phone_change;
      user.phone_confirmed_at = new Date().toISOString();
      return reply(200, session());
    }
    if (['valid-once', 'recovery-once'].includes(input.token_hash) && !usedLinks.has(input.token_hash)) {
      usedLinks.add(input.token_hash);
      revoked = false;
      return reply(200, session());
    }
    return reply(403, { msg: 'Token expired' });
  }
  return reply(404, {});
});
await new Promise((resolve) => provider.listen(3211, '127.0.0.1', resolve));
let stack;
try {
  stack = await startStack(
    3210,
    { SUPABASE_URL: 'http://127.0.0.1:3211', SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key' },
    { build: !process.argv.includes('--no-build') },
  );
} catch (error) {
  provider.close();
  throw error;
}
const { app } = stack;
let startupOutput = '';
app.stdout.on('data', (chunk) => {
  startupOutput += chunk;
});
app.stderr.on('data', (chunk) => {
  startupOutput += chunk;
});
const origin = 'http://localhost:3210';
const post = (action, body, cookie, requestOrigin = origin) =>
  fetch(`${origin}/api/auth/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body ?? {}),
  });
let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks++;
}
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(origin);
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(250);
  }
  assert.ok(ready, `Test app did not start: ${startupOutput}`);
  const valid = {
    email: 'fixture@example.test',
    password: 'safe-password-123',
    confirmPassword: 'safe-password-123',
    name: 'Khách thử nghiệm',
    acceptTerms: true,
  };
  for (const path of ['/', '/sign-in', '/sign-up'])
    check((await fetch(`${origin}${path}`, { redirect: 'manual' })).status === 200, `Guest can open ${path}`);
  check((await fetch(`${origin}/api/auth/me`)).status === 401, 'Anonymous profile must be blocked');
  check(
    (await post('signin', valid, undefined, 'https://other.example')).status === 403,
    'Cross-origin login must be blocked',
  );
  check(
    (await post('signup', { ...valid, role: 'Admin' })).status === 400,
    'Public signup must reject role escalation',
  );
  check((await post('signup', { ...valid, password: 'short' })).status === 400, 'Short password must be rejected');
  check((await post('signup', { ...valid, acceptTerms: false })).status === 400, 'Terms must be explicit');
  const signup = await post('signup', valid);
  check(
    signup.status === 200 && signup.headers.getSetCookie().length === 0,
    'Unverified signup must not create a browser session',
  );
  check(
    (await post('resend', { email: valid.email })).status === 200,
    'Resend must work without revealing account existence',
  );
  const signin = await post('signin', valid);
  check(signin.status === 200, 'Valid credentials must sign in');
  check((await signin.json()).destination === '/', 'Customer login returns to the homepage');
  const setCookies = signin.headers.getSetCookie();
  const sessionCookies = setCookies.filter((c) => /^pose-(access|refresh)=fixture/.test(c));
  check(
    sessionCookies.length === 2 && sessionCookies.every((c) => /HttpOnly/i.test(c) && /SameSite=lax/i.test(c)),
    'Session cookies must be HttpOnly and SameSite',
  );
  const cookie = sessionCookies.map((c) => c.split(';')[0]).join('; ');
  const me = await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie } });
  check(
    me.status === 200 && (await me.json()).user.name === user.user_metadata.display_name,
    'Profile must be fetched from verified provider identity',
  );
  check(me.headers.get('cache-control') === 'no-store', 'Profile must not be cached');
  const protectedPage = (path) => fetch(`${origin}${path}`, { headers: { Cookie: cookie }, redirect: 'manual' });
  const checkGuestEntryRedirects = async (destination) => {
    for (const path of ['/sign-in', '/sign-up']) {
      const response = await protectedPage(path);
      check(
        response.status === 307 && response.headers.get('location') === destination,
        `Signed-in ${accessRole} entering ${path} opens ${destination}`,
      );
      check(
        !(await response.text()).includes('Thông tin rõ ràng.'),
        'Signed-in guest entry must not render landing content',
      );
    }
  };
  const signedInLanding = await protectedPage('/');
  const signedInLandingHtml = await signedInLanding.text();
  check(
    signedInLanding.status === 200 && signedInLandingHtml.includes('account-trigger'),
    'Signed-in landing stays public and shows account navigation',
  );
  check(
    !signedInLandingHtml.includes('href="/customer"'),
    'Customer account navigation has no removed customer-home link',
  );
  await checkGuestEntryRedirects('/');
  for (const path of ['/customer/favorites', '/customer/inquiries', '/customer/inquiries/new', '/properties']) {
    const header = (await (await protectedPage(path)).text()).match(/<header\b[\s\S]*?<\/header>/)?.[0] || '';
    check(
      header.includes('Hồ sơ cá nhân') &&
        header.includes('Đăng xuất') &&
        !header.includes('href="/sign-in"') &&
        !header.includes('href="/sign-up"'),
      `First HTML of ${path} already contains the signed-in header`,
    );
  }
  const refreshOnly = { Cookie: 'pose-refresh=fixture-refresh' };
  check(
    (await fetch(origin, { headers: refreshOnly, redirect: 'manual' })).headers.get('location') ===
      '/auth/refresh?next=%2F',
    'Expired access on landing renews through the writable handler',
  );
  for (const path of ['/', '/sign-in', '/sign-up'])
    check(
      (
        await fetch(`${origin}/auth/refresh?next=${encodeURIComponent(path)}`, {
          headers: refreshOnly,
          redirect: 'manual',
        })
      ).headers.get('location') === `${origin}/`,
      'Refreshed guest entry opens the homepage directly',
    );
  const invalidRefresh = await fetch(`${origin}/auth/refresh?next=%2F`, {
    headers: { Cookie: 'pose-refresh=expired' },
    redirect: 'manual',
  });
  check(
    invalidRefresh.headers.get('location') === `${origin}/` &&
      invalidRefresh.headers.getSetCookie().some((c) => c.startsWith('pose-refresh=;')),
    'Invalid refresh returns to guest landing and clears the stale cookie',
  );
  check(
    (
      await fetch(`${origin}/auth/refresh?next=https://evil.example`, { headers: refreshOnly, redirect: 'manual' })
    ).headers.get('location') === `${origin}/`,
    'Refresh cannot redirect to an external destination',
  );
  const catalogNext = '/properties?type=Apartment&minPrice=3000000000';
  check(
    (
      await fetch(`${origin}/auth/refresh?next=${encodeURIComponent(catalogNext)}`, {
        headers: refreshOnly,
        redirect: 'manual',
      })
    ).headers.get('location') === `${origin}${catalogNext}`,
    'Catalog refresh preserves the active filters',
  );
  check(
    (
      await fetch(`${origin}/auth/refresh?next=${encodeURIComponent(catalogNext)}`, {
        headers: { Cookie: 'pose-refresh=expired' },
        redirect: 'manual',
      })
    ).headers.get('location') === `${origin}${catalogNext}`,
    'Invalid catalog refresh returns to the public page without a loop',
  );
  check(
    (
      await fetch(`${origin}/auth/refresh?next=${encodeURIComponent('/properties/../../evil')}`, {
        headers: refreshOnly,
        redirect: 'manual',
      })
    ).headers.get('location') === `${origin}/`,
    'Catalog refresh rejects path traversal',
  );
  check(
    (await fetch(`${origin}/customer`, { redirect: 'manual' })).headers.get('location')?.endsWith('/sign-in'),
    'Customer homepage requires login',
  );
  const customerHomeRedirect = await protectedPage('/customer');
  check(
    customerHomeRedirect.status === 307 && customerHomeRedirect.headers.get('location')?.endsWith('/'),
    'Customer route redirects to the shared homepage',
  );
  check(
    (await (await post('session', { access_token: 'fixture-access', refresh_token: 'fixture-refresh' })).json())
      .destination === '/',
    'Email session callback opens the homepage',
  );
  const verified = await fetch(`${origin}/auth/confirm?token_hash=valid-once&type=email`, { redirect: 'manual' });
  check(verified.headers.get('location') === `${origin}/`, 'Verified email opens the homepage');
  check(
    (await fetch(`${origin}/account`, { redirect: 'manual' })).status === 307,
    'Account page must be protected on the server',
  );
  check(
    (await protectedPage('/admin')).headers.get('location')?.endsWith('/forbidden'),
    'User must not open admin page directly',
  );
  check(
    (await protectedPage('/sales')).headers.get('location')?.endsWith('/forbidden'),
    'User must not open sales page directly',
  );
  for (const page of ['/sales/leads', '/sales/appointments', '/sales/reports', '/admin/appointments'])
    check((await protectedPage(page)).headers.get('location')?.endsWith('/forbidden'), `User must not open ${page}`);
  check(
    (await fetch(`${origin}/api/workspace/admin`, { headers: { Cookie: cookie } })).status === 403,
    'User must not access admin BFF',
  );
  check((await fetch(`${origin}/api/workspace/sales`)).status === 401, 'Anonymous workspace API must be denied');
  user.user_metadata.role = 'Admin';
  check(
    (await protectedPage('/')).status === 200 && (await (await protectedPage('/')).text()).includes('account-trigger'),
    'Landing ignores forged user metadata role and shows the account trigger',
  );
  check(
    (await protectedPage('/admin')).headers.get('location')?.endsWith('/forbidden'),
    'Editable metadata must not grant Admin',
  );
  accessRole = 'Sales';
  await checkGuestEntryRedirects('/');
  check(
    (await protectedPage('/customer')).headers.get('location')?.endsWith('/forbidden'),
    'Sales cannot open customer-only homepage',
  );
  check((await (await post('signin', valid)).json()).destination === '/', 'Sales login returns to the homepage');
  check((await protectedPage('/sales')).status === 200, 'Sales can open sales page');
  for (const page of ['leads', 'appointments', 'reports']) {
    check((await protectedPage(`/sales/${page}`)).status === 200, `Sales can open /sales/${page}`);
    check(
      (await protectedPage(`/${page}`)).headers.get('location')?.endsWith(`/sales/${page}`),
      `Old /${page} sends Sales to /sales/${page}`,
    );
    check(
      (await protectedPage(`/admin/${page}`)).headers.get('location')?.endsWith('/forbidden'),
      `Sales cannot open /admin/${page}`,
    );
  }
  check(
    (await protectedPage('/admin')).headers.get('location')?.endsWith('/forbidden'),
    'Sales cannot open admin page',
  );
  accessRole = 'Admin';
  await checkGuestEntryRedirects('/');
  check((await (await post('signin', valid)).json()).destination === '/', 'Admin login returns to the homepage');
  check((await protectedPage('/admin')).status === 200, 'Admin can open admin page');
  check((await protectedPage('/sales')).status === 200, 'Admin can open sales page');
  for (const page of ['leads', 'appointments', 'reports']) {
    check(
      (await protectedPage(`/${page}`)).headers.get('location')?.endsWith(`/admin/${page}`),
      `Old /${page} sends Admin to /admin/${page}`,
    );
    check((await protectedPage(`/sales/${page}`)).status === 200, `Admin can open /sales/${page}`);
  }
  accessRole = 'User';
  check(
    (await protectedPage('/admin')).headers.get('location')?.endsWith('/forbidden'),
    'Role downgrade must take effect immediately',
  );
  const refreshed = await fetch(`${origin}/api/auth/me`, { headers: { Cookie: 'pose-refresh=fixture-refresh' } });
  check(
    refreshed.status === 200 && refreshed.headers.getSetCookie().length === 2,
    'Expired access cookie must refresh and rotate browser cookies',
  );
  const refreshRedirect = await fetch(`${origin}/account`, {
    headers: { Cookie: 'pose-refresh=fixture-refresh' },
    redirect: 'manual',
  });
  check(
    refreshRedirect.headers.get('location')?.includes('/auth/refresh?next='),
    'SSR refresh must use a writable route handler',
  );
  const safeRedirect = await fetch(`${origin}/auth/refresh?next=https://evil.example`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  check(
    safeRedirect.headers.get('location') === `${origin}/`,
    'Refresh must reject open redirects and fall back to homepage',
  );
  providerOffline = true;
  const unavailable = await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie } });
  check(
    unavailable.status === 503 && unavailable.headers.getSetCookie().length === 0,
    'Provider outages must not destroy cookies',
  );
  providerOffline = false;
  accountActive = false;
  check(
    (await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie } })).status === 401,
    'Suspended account must lose access',
  );
  accountActive = true;
  check(
    (await post('session', { access_token: 'forged', refresh_token: 'fixture-refresh' })).status === 401,
    'Callback must reject forged access token',
  );
  const expired = await fetch(`${origin}/auth/confirm?token_hash=expired&type=email`, { redirect: 'manual' });
  check(
    expired.status === 307 && expired.headers.get('location').endsWith('/sign-in?verification=failed'),
    'Expired verification must show recovery flow',
  );
  const logout = await post('logout', {}, cookie);
  check(
    logout.status === 200 && logout.headers.getSetCookie().some((c) => c.startsWith('pose-access=;')),
    'Logout must revoke provider session and clear cookies',
  );
  check(
    (await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie } })).status === 401,
    'Revoked session must be rejected',
  );
  check(
    (await protectedPage('/')).headers.get('location')?.startsWith('/auth/refresh?'),
    'Revoked access with stale refresh is checked instead of reopening a role home',
  );
  const revokedRefresh = await fetch(`${origin}/auth/refresh?next=%2F`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  check(revokedRefresh.headers.get('location') === `${origin}/`, 'Revoked refresh returns to guest landing');
  check((await fetch(origin, { redirect: 'manual' })).status === 200, 'Landing is available after logout');
  for (let i = 0; i < 5; i++)
    check(
      (await post('signin', { email: 'wrong@example.test', password: 'incorrect' })).status === 401,
      'Incorrect password must not grant a session',
    );
  check(
    (await post('signin', { email: 'wrong@example.test', password: 'incorrect' })).status === 429,
    'Sixth incorrect attempt must be limited',
  );
  // Profile and recovery flows exercise production route handlers, not helpers.
  await post('signin', valid);
  const profileRequest = (body, cookies = cookie, requestOrigin = origin) =>
    fetch(`${origin}/api/account/profile`, {
      method: 'PATCH',
      headers: { Cookie: cookies, Origin: requestOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const profileInput = { name: 'Khách cập nhật', phone: '0912345678', notificationsEnabled: false, version: 0 };
  check((await profileRequest(profileInput, '')).status === 401, 'Anonymous profile edits denied');
  check(
    (await profileRequest(profileInput, cookie, 'https://evil.example')).status === 403,
    'Cross-origin profile edits denied',
  );
  for (const forbidden of ['role', 'user_id', 'phoneVerified', 'account_status'])
    check(
      (await profileRequest({ ...profileInput, [forbidden]: 'forged' })).status === 400,
      'Privilege/ownership fields denied',
    );
  const updatedProfile = await profileRequest(profileInput);
  check(
    updatedProfile.status === 200 && (await updatedProfile.json()).profile.phone === '+84912345678',
    'Profile edit normalizes phone',
  );
  check((await profileRequest(profileInput)).status === 409, 'Stale edits must not overwrite current profile');
  check(
    (await (await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie } })).json()).user.name ===
      profileInput.name,
    'Current name displayed after profile edit',
  );
  const phonePost = (action, body) =>
    fetch(`${origin}/api/account/phone/${action}`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  check((await phonePost('send', {})).status === 200, 'Phone OTP can be requested for saved number');
  check((await phonePost('verify', { token: '000000' })).status === 400, 'Wrong phone OTP denied');
  const phoneVerified = await phonePost('verify', { token: '123456' });
  check(
    phoneVerified.status === 200 && (await phoneVerified.json()).profile.phoneVerified,
    'Phone marked verified only after provider verification',
  );
  check(
    (await profileRequest({ ...profileInput, phone: '0987654321', version: profile.version })).status === 200 &&
      !profile.phoneVerified,
    'Changing number clears verified status',
  );
  const avatarPost = (file) => {
    const form = new FormData();
    form.set('file', file);
    form.set('version', String(profile.version));
    return fetch(`${origin}/api/account/avatar`, {
      method: 'POST',
      headers: { Origin: origin, Cookie: cookie },
      body: form,
    });
  };
  const missingAvatarVersion = new FormData();
  missingAvatarVersion.set('file', new File([avatar], 'valid.png', { type: 'image/png' }));
  check(
    (
      await fetch(`${origin}/api/account/avatar`, {
        method: 'POST',
        headers: { Origin: origin, Cookie: cookie },
        body: missingAvatarVersion,
      })
    ).status === 400,
    'Avatar upload requires an explicit profile version',
  );
  check(
    (await avatarPost(new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' }))).status === 400,
    'SVG avatar denied',
  );
  check(
    (await avatarPost(new File(['not-a-png'], 'bad.png', { type: 'image/png' }))).status === 400,
    'Fake image MIME denied',
  );
  check(
    (await avatarPost(new File([avatar], 'valid.png', { type: 'image/png' }))).status === 200,
    'Valid avatar decoded and stored',
  );
  const knownRecovery = await post('forgot-password', { email: user.email });
  const unknownRecovery = await post('forgot-password', { email: 'nobody@example.test' });
  check(
    knownRecovery.status === 200 &&
      unknownRecovery.status === 200 &&
      (await knownRecovery.json()).message === (await unknownRecovery.json()).message,
    'Recovery must not reveal whether email exists',
  );
  check(
    (
      await post(
        'reset-password',
        { password: 'new-safe-password-123', confirmPassword: 'new-safe-password-123' },
        cookie,
      )
    ).status === 401,
    'Ordinary login cookie alone does not authorize password recovery',
  );
  const failedRecovery = await fetch(`${origin}/auth/confirm?token_hash=expired&type=recovery`, { redirect: 'manual' });
  check(
    failedRecovery.headers.get('location')?.endsWith('/reset-password?verification=failed'),
    'Expired recovery link rejected',
  );
  const recovery = await fetch(`${origin}/auth/confirm?token_hash=recovery-once&type=recovery`, { redirect: 'manual' });
  check(
    recovery.status === 307 && recovery.headers.get('location')?.endsWith('/reset-password'),
    'Verified recovery link opens reset page',
  );
  const recoveryCookies = recovery.headers
    .getSetCookie()
    .filter((c) => /^pose-recovery-(access|refresh)=fixture/.test(c));
  check(
    recoveryCookies.length === 2 && recoveryCookies.every((c) => /HttpOnly/i.test(c)),
    'Recovery credentials stay in HttpOnly cookies',
  );
  const recoveryCookie = recoveryCookies.map((c) => c.split(';')[0]).join('; ');
  check(
    (await post('reset-password', { password: 'short', confirmPassword: 'short' }, recoveryCookie)).status === 400,
    'Weak password denied before consuming link',
  );
  const reset = await post(
    'reset-password',
    { password: 'new-safe-password-123', confirmPassword: 'new-safe-password-123' },
    recoveryCookie,
  );
  check(reset.status === 200 && currentPassword === 'new-safe-password-123', 'Recovery changes password');
  check(
    (
      await post(
        'reset-password',
        { password: 'new-safe-password-456', confirmPassword: 'new-safe-password-456' },
        recoveryCookie,
      )
    ).status === 401,
    'Recovery credential cannot be reused',
  );
  check(
    (await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie } })).status === 401,
    'Password reset revokes older sessions',
  );
  check(
    (await fetch(`${origin}/auth/confirm?token_hash=recovery-once&type=recovery`, { redirect: 'manual' })).headers
      .get('location')
      ?.includes('verification=failed'),
    'Used recovery email token denied',
  );
  check((await post('signin', valid)).status === 401, 'Old password rejected after reset');
  check((await post('signin', { ...valid, password: currentPassword })).status === 200, 'New password signs in');
  // Run the Google PKCE flow through Next's production proxy and NestJS. The
  // provider is isolated; this never contacts Google or creates a real account.
  const loginHtml = await (await fetch(`${origin}/sign-in`)).text();
  check(loginHtml.includes('Tiếp tục với Google'), 'Sign-in renders the Google option');
  check((await post('google', { acceptTerms: false })).status === 400, 'Google requires explicit terms');
  check(
    (await post('google', { acceptTerms: true }, undefined, 'https://evil.example')).status === 403,
    'Google rejects a forged origin',
  );
  const googleStart = await post('google', { acceptTerms: true, next: '/customer/inquiries/new' });
  check(googleStart.status === 200, 'Google start passes through the frontend proxy');
  const authorize = new URL((await googleStart.json()).url);
  check(authorize.searchParams.get('code_challenge_method') === 's256', 'Google uses S256 PKCE');
  check(
    authorize.searchParams.get('redirect_to') === `${origin}/api/auth/google/callback`,
    'Google callback uses the public frontend origin',
  );
  oauthChallenge = authorize.searchParams.get('code_challenge');
  const flow = googleStart.headers.getSetCookie().find((value) => value.startsWith('pose-google-flow='));
  check(
    Boolean(flow) && /HttpOnly/.test(flow) && /Secure/.test(flow),
    'Proxy preserves the secure OAuth transaction cookie',
  );
  const googleCallback = await fetch(`${origin}/api/auth/google/callback?code=oauth-once`, {
    headers: { Cookie: flow.split(';')[0] },
    redirect: 'manual',
  });
  check(
    googleCallback.status === 303 && googleCallback.headers.get('location') === `${origin}/customer/inquiries/new`,
    'Google callback resumes the customer inquiry',
  );
  const googleCookies = googleCallback.headers
    .getSetCookie()
    .filter((value) => /^pose-(access|refresh)=fixture/.test(value));
  check(
    googleCookies.length === 2 && googleCookies.every((value) => /HttpOnly/.test(value)),
    'Google session remains backend-managed',
  );
  const googleCookie = googleCookies.map((value) => value.split(';')[0]).join('; ');
  check(
    (
      await (await fetch(`${origin}/api/auth/me`, { headers: { Cookie: googleCookie } })).json()
    ).user.providers.includes('google'),
    'Google identity is available in the account profile',
  );
  check(
    (await fetch(`${origin}/api/auth/admin`, { headers: { Cookie: googleCookie } })).status === 403,
    'Google customer cannot access Admin API',
  );
  const replay = await fetch(`${origin}/api/auth/google/callback?code=oauth-once`, {
    headers: { Cookie: flow.split(';')[0] },
    redirect: 'manual',
  });
  check(
    replay.headers.get('location') === `${origin}/sign-in?oauth=failed`,
    'Google authorization code cannot be reused',
  );
  const missingFlow = await fetch(`${origin}/api/auth/google/callback?code=oauth-once`, { redirect: 'manual' });
  check(
    missingFlow.headers.get('location') === `${origin}/sign-in?oauth=expired`,
    'Google callback rejects a missing browser transaction',
  );
  check((await post('logout', {}, googleCookie)).status === 200, 'Google login supports ordinary application logout');
  const oauthErrorHtml = await (await fetch(`${origin}/sign-in?oauth=cancelled`)).text();
  check(oauthErrorHtml.includes('Bạn đã hủy'), 'OAuth cancellation has a clear Vietnamese message');
  console.log(`PASS: ${checks} auth integration checks; no real user/email created.`);
  if (process.argv.includes('--preview')) {
    currentPassword = valid.password;
    revoked = false;
    usedOAuthCodes.clear();
    console.log(`PREVIEW READY: ${origin}; fixture@example.test / safe-password-123 (fake provider only).`);
    await new Promise((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
  }
} finally {
  await stack.close();
  provider.close();
}
