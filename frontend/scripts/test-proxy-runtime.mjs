import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { startStack } from './test-stack.mjs';

const origin = 'http://localhost:3200';
const unusedBackend = 'http://127.0.0.1:3240';
const propertyId = '00000000-0000-4000-8000-000000000002';
const user = {
  id: '00000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  email: 'fixture@example.test',
  email_confirmed_at: '2026-10-01',
  user_metadata: {},
};
const profile = {
  name: 'Runtime fixture',
  phone: '',
  phoneVerified: false,
  notificationsEnabled: true,
  avatarPath: null,
  version: 0,
};
const session = {
  access_token: 'fixture-access',
  refresh_token: 'fixture-refresh',
  token_type: 'bearer',
  expires_in: 3600,
  user,
};
let uploaded,
  propertyVersion = 0,
  stack,
  checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks++;
};

// A valid PDF larger than the default 10 MB proxy buffer.
let document = '%PDF-1.4\n%' + 'x'.repeat(11 * 1024 * 1024) + '\n';
const offsets = [];
for (const [index, object] of [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>',
].entries()) {
  offsets.push(Buffer.byteLength(document));
  document += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = Buffer.byteLength(document);
document +=
  'xref\n0 4\n0000000000 65535 f \n' +
  offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
  `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const pdf = Buffer.from(document);

const provider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  const input =
    bytes.length && request.headers['content-type']?.includes('application/json') ? JSON.parse(bytes.toString()) : {};
  const url = new URL(request.url, 'http://localhost');
  const reply = (status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  if (url.pathname.endsWith('/token') || url.pathname.endsWith('/verify')) return reply(200, session);
  if (url.pathname.endsWith('/user'))
    return request.headers.authorization === 'Bearer fixture-access'
      ? reply(200, user)
      : reply(401, { msg: 'Invalid token' });
  if (url.pathname.endsWith('/pose_access_context'))
    return reply(200, { user_id: user.id, role: 'Admin', active: true, session_valid: true });
  if (url.pathname.endsWith('/pose_read_profile')) return reply(200, profile);
  if (url.pathname.endsWith('/property_products')) return reply(200, [{ id: propertyId, version: propertyVersion }]);
  if (url.pathname.includes('/storage/v1/object/property-files/')) {
    uploaded = bytes;
    return reply(200, { Key: 'fixture.pdf' });
  }
  if (url.pathname.endsWith('/pose_save_catalog')) {
    propertyVersion++;
    return reply(200, { id: '00000000-0000-4000-8000-000000000003', ...input.p_data });
  }
  return reply(404, {});
});

async function ready() {
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return response;
    } catch {}
    await delay(100);
  }
  throw new Error('Runtime proxy did not start');
}

async function realtime() {
  const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/socket.io?EIO=4&transport=websocket`);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Realtime proxy timed out')), 5000);
      const finish = (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      socket.onerror = () => finish(new Error('Realtime transport failed'));
      socket.onmessage = (event) => {
        const frame = String(event.data);
        try {
          if (frame.startsWith('0')) socket.send('40' + JSON.stringify({ token: session.access_token }));
          else if (frame.startsWith('40')) socket.send('42' + JSON.stringify(['message', {}]));
          else if (frame.startsWith('44')) finish(new Error('Realtime session rejected'));
          else if (frame.startsWith('42')) {
            assert.deepEqual(JSON.parse(frame.slice(2)), ['message', { message: 'Hello from NestJS Backend!' }]);
            finish();
          }
        } catch (error) {
          finish(error);
        }
      };
    });
  } finally {
    socket.close();
  }
}

try {
  await assert.rejects(fetch(unusedBackend, { signal: AbortSignal.timeout(500) }));
  await new Promise((resolve) => provider.listen(3201, '127.0.0.1', resolve));
  const env = {
    SUPABASE_URL: 'http://127.0.0.1:3201',
    SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: '3240',
  };
  for (const standalone of [false, true]) {
    propertyVersion = 0;
    uploaded = undefined;
    // Build once with the wrong URL, then reuse that build on a different backend port.
    stack = await startStack(3200, env, {
      build: !standalone,
      buildBackendUrl: unusedBackend,
      standalone,
      backendPort: standalone ? 3203 : 3202,
    });
    const health = await ready();
    assert.deepEqual(
      await health.json(),
      { ok: true, supabase: true, redis: false },
      'Health reaches the runtime backend',
    );
    checks++;
    const signIn = await fetch(`${origin}/api/auth/signin`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'safe-password-123' }),
    });
    check(signIn.status === 200, 'Auth JSON and Origin reach NestJS');
    const cookies = signIn.headers.getSetCookie().filter((value) => /^pose-(access|refresh)=fixture/.test(value));
    check(
      cookies.length === 2 &&
        cookies.every((value) => /HttpOnly/i.test(value) && /Secure/i.test(value) && /SameSite=lax/i.test(value)),
      'All session cookies survive the proxy',
    );
    const cookie = cookies.map((value) => value.split(';')[0]).join('; ');
    const me = await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie } });
    check(
      me.status === 200 && (await me.json()).user.id === user.id,
      'Cookie authentication reaches the runtime backend',
    );
    check(me.headers.get('cache-control') === 'no-store', 'Response headers survive the proxy');
    const page = await fetch(origin, { headers: { Cookie: cookie }, redirect: 'manual' });
    check(page.headers.get('location') === '/admin', 'Server component session lookup uses the runtime backend');
    const confirmation = await fetch(`${origin}/auth/confirm?token_hash=fixture&type=email`, { redirect: 'manual' });
    check(
      confirmation.status === 307 &&
        confirmation.headers.get('location') === `${origin}/admin` &&
        confirmation.headers.getSetCookie().length === 2,
      'Auth callback query, redirect and cookies survive',
    );
    const refresh = await fetch(`${origin}/auth/refresh?next=%2Faccount`, {
      headers: { Cookie: 'pose-refresh=fixture-refresh' },
      redirect: 'manual',
    });
    check(
      refresh.status === 307 &&
        refresh.headers.get('location') === `${origin}/account` &&
        refresh.headers.getSetCookie().length === 2,
      'Refresh route uses the runtime backend',
    );
    const form = new FormData();
    for (const [key, value] of Object.entries({
      name: 'Runtime document',
      visibility: 'Public',
      sort_order: '0',
      version: '0',
    }))
      form.set(key, value);
    form.set('file', new File([pdf], 'runtime.pdf', { type: 'application/pdf' }));
    const upload = await fetch(`${origin}/api/admin/catalog/properties/${propertyId}/media`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin },
      body: form,
    });
    check(upload.status === 201, 'Multipart upload larger than 10 MB reaches NestJS');
    check(uploaded?.equals(pdf), 'Multipart bytes reach storage intact');
    const invalid = await fetch(`${origin}/api/catalog/properties?page=0`);
    check(
      invalid.status === 400 && (await invalid.json()).code === 'INVALID_PAGE',
      'Query strings and error statuses survive',
    );
    await realtime();
    check(true, 'Socket.IO upgrades use the runtime backend');
    await stack.close();
    stack = undefined;
  }
  console.log(`PASS: ${checks} runtime proxy checks; one build, next start and standalone, fake provider only.`);
} finally {
  await stack?.close();
  provider.closeAllConnections();
  await new Promise((resolve) => provider.close(resolve));
}
