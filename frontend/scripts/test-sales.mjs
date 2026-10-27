import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';
import { startStack } from './test-stack.mjs';

// The HTTP boundary fixture never connects to live Auth or sends email.
// SQL authorization, transactions and triggers are tested with actual Postgres
// in backend/test/sales-database.spec.ts.
const origin = 'http://localhost:3240',
  secret = 'fixture-server-key';
const ids = {
  Admin: '00000000-0000-4000-8000-000000000001',
  Sales: '00000000-0000-4000-8000-000000000002',
  User: '00000000-0000-4000-8000-000000000003',
};
const users = new Map(),
  rows = new Map(),
  histories = new Map(),
  tokens = new Map();
let failActivation = false,
  commitThenError = false,
  createCalls = 0,
  checks = 0;
const clone = (value) => structuredClone(value);
const check = (condition, message) => {
  assert.ok(condition, message);
  checks++;
};
function seed() {
  users.clear();
  rows.clear();
  histories.clear();
  tokens.clear();
  for (const role of ['Admin', 'Sales', 'User']) {
    const id = ids[role],
      now = new Date().toISOString();
    users.set(id, {
      id,
      aud: 'authenticated',
      email: `${role.toLowerCase()}@example.test`,
      email_confirmed_at: now,
      created_at: now,
      app_metadata: { role, account_status: 'active' },
      user_metadata: { display_name: role === 'Admin' ? 'Quản trị viên' : 'Nguyễn Minh An' },
      password: 'safe-password-123',
      epoch: 0,
    });
    if (role === 'Sales')
      rows.set(id, {
        id,
        email: 'sales@example.test',
        name: 'Nguyễn Minh An',
        phone: '+84912345678',
        status: 'active',
        version: 0,
        profile_version: 0,
        requires_activation: false,
        email_verified: true,
        last_sign_in_at: now,
        created_at: now,
        updated_at: now,
      });
  }
  const id = '00000000-0000-4000-8000-000000000004',
    now = new Date().toISOString();
  rows.set(id, {
    id,
    email: 'sales2@example.test',
    name: 'Trần Hoàng Anh',
    phone: '',
    status: 'suspended',
    version: 0,
    profile_version: 0,
    requires_activation: false,
    email_verified: true,
    last_sign_in_at: null,
    created_at: now,
    updated_at: now,
  });
  users.set(id, {
    ...clone(users.get(ids.Sales)),
    id,
    email: 'sales2@example.test',
    app_metadata: { role: 'Sales', account_status: 'suspended' },
  });
}
seed();
function safeUser(user) {
  return Object.fromEntries(Object.entries(user).filter(([key]) => !['password', 'epoch'].includes(key)));
}
function session(user) {
  const token = randomUUID();
  tokens.set(token, { id: user.id, epoch: user.epoch });
  return { access_token: token, refresh_token: token, expires_in: 3600, token_type: 'bearer', user: safeUser(user) };
}
function audit(id, action, before, reason) {
  const list = histories.get(id) || [];
  list.unshift({
    id: randomUUID(),
    actor_id: ids.Admin,
    actor_name: 'Quản trị viên',
    action,
    before_data: before,
    after_data: clone(rows.get(id)),
    reason,
    created_at: new Date().toISOString(),
  });
  histories.set(id, list);
}
function changeStatus(id, status, reason) {
  const row = rows.get(id),
    before = clone(row),
    user = users.get(id);
  if (row.status !== status || row.requires_activation) {
    Object.assign(row, {
      status,
      version: row.version + 1,
      requires_activation: false,
      updated_at: new Date().toISOString(),
    });
    user.app_metadata.account_status = status;
    user.app_metadata.m11_pending = false;
    if (status === 'suspended') user.epoch++;
    audit(id, status === 'active' ? 'Activated' : 'Suspended', before, reason);
  }
  return row;
}
const provider = createServer(async (request, response) => {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const input = raw ? JSON.parse(raw) : {},
    url = new URL(request.url, origin),
    token = request.headers.authorization?.slice(7),
    ticket = tokens.get(token),
    user = users.get(ticket?.id);
  const valid = user && ticket.epoch === user.epoch;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('X-Supabase-Api-Version', '2024-01-01');
  const reply = (status, value) => {
    response.writeHead(status);
    response.end(JSON.stringify(value));
  };
  const error = (code, message = code) => reply(400, { code, message });
  if (url.pathname.endsWith('/token')) {
    const found =
      url.searchParams.get('grant_type') === 'password'
        ? [...users.values()].find((item) => item.email === input.email && item.password === input.password)
        : valid
          ? user
          : null;
    return found ? reply(200, session(found)) : reply(400, { code: 'invalid_credentials', msg: 'Invalid credentials' });
  }
  if (url.pathname.includes('/auth/v1/admin/users')) {
    assert.equal(request.headers.apikey, secret, 'Auth admin requires server key');
    if (request.method === 'GET') {
      const target = users.get(url.pathname.split('/').at(-1));
      return target ? reply(200, safeUser(target)) : reply(404, { code: 'user_not_found', msg: 'Not found' });
    }
    createCalls++;
    if ([...users.values()].some((item) => item.email === input.email))
      return reply(422, { code: 'email_exists', msg: 'Email exists' });
    assert.equal(input.app_metadata.role, 'Sales');
    assert.equal(input.app_metadata.account_status, 'suspended');
    assert.equal(input.email_confirm, true);
    const now = new Date().toISOString(),
      profile = input.app_metadata.m11_profile;
    const target = {
      id: input.id,
      email: input.email,
      password: input.password,
      aud: 'authenticated',
      email_confirmed_at: now,
      created_at: now,
      app_metadata: input.app_metadata,
      user_metadata: input.user_metadata,
      epoch: 0,
    };
    users.set(target.id, target);
    rows.set(target.id, {
      id: target.id,
      email: target.email,
      name: profile.name,
      phone: profile.phone,
      status: 'suspended',
      requires_activation: true,
      version: 1,
      profile_version: 0,
      email_verified: true,
      last_sign_in_at: null,
      created_at: now,
      updated_at: now,
    });
    audit(target.id, 'Created', null, 'Tạo tài khoản Sales nội bộ');
    return commitThenError ? reply(400, { code: 'timeout', msg: 'Response lost' }) : reply(200, safeUser(target));
  }
  if (url.pathname.endsWith('/user')) return valid ? reply(200, safeUser(user)) : reply(401, { msg: 'Invalid token' });
  if (url.pathname.endsWith('/logout')) return reply(200, {});
  if (url.pathname.endsWith('/account_profiles')) return reply(200, [{ user_id: user?.id }]);
  if (url.pathname.endsWith('/account_history')) return reply(200, []);
  const rpc = url.pathname.split('/rpc/')[1];
  if (rpc === 'pose_access_context')
    return reply(200, {
      user_id: user?.id,
      role: user?.app_metadata.role,
      active: user?.app_metadata.account_status === 'active',
      session_valid: !!valid,
    });
  if (rpc === 'pose_read_profile')
    return reply(200, {
      name: rows.get(user?.id)?.name || user?.user_metadata.display_name,
      phone: rows.get(user?.id)?.phone || '',
      avatarPath: null,
      version: 0,
      notificationsEnabled: true,
      updatedAt: null,
    });
  if (!rpc?.startsWith('pose_admin_sales_')) return reply(404, {});
  if (!valid || user.app_metadata.role !== 'Admin' || user.app_metadata.account_status !== 'active')
    return error('42501');
  if (rpc === 'pose_admin_sales_list') {
    const all = [...rows.values()],
      filtered = all.filter(
        (row) =>
          (input.p_status === 'all' || row.status === input.p_status) &&
          `${row.name} ${row.email} ${row.phone}`.toLowerCase().includes(input.p_query.toLowerCase()),
      );
    return reply(200, {
      items: filtered.slice((input.p_page - 1) * input.p_size, input.p_page * input.p_size),
      total: filtered.length,
      page: input.p_page,
      pageSize: input.p_size,
      stats: {
        total: all.length,
        active: all.filter((row) => row.status === 'active').length,
        suspended: all.filter((row) => row.status === 'suspended').length,
      },
    });
  }
  const row = rows.get(input.p_id);
  if (!row) return error('P0002');
  if (rpc === 'pose_admin_sales_detail') return reply(200, row);
  if (rpc === 'pose_admin_sales_history') {
    const list = histories.get(row.id) || [];
    return reply(200, {
      items: list.slice((input.p_page - 1) * 20, input.p_page * 20),
      total: list.length,
      page: input.p_page,
      pageSize: 20,
    });
  }
  if (rpc === 'pose_admin_sales_finish_create') {
    if (failActivation) return error('provider_unavailable');
    const replayed = !row.requires_activation;
    if (!replayed) changeStatus(row.id, 'active', 'Kích hoạt tài khoản Sales vừa tạo');
    return reply(200, { item: row, replayed });
  }
  if (
    input.p_version !== row.version ||
    (rpc === 'pose_admin_sales_update' && input.p_profile_version !== row.profile_version)
  )
    return error('40001');
  if (rpc === 'pose_admin_sales_status') return reply(200, changeStatus(row.id, input.p_status, input.p_reason));
  if (rpc === 'pose_admin_sales_update') {
    const before = clone(row);
    Object.assign(row, input.p_data, {
      version: row.version + 1,
      profile_version: row.profile_version + 1,
      updated_at: new Date().toISOString(),
    });
    audit(row.id, 'Updated', before, input.p_reason);
    return reply(200, row);
  }
  return reply(404, {});
});
await new Promise((resolve) => provider.listen(3241, '127.0.0.1', resolve));
let stack, socket;
const api = (path = '', method = 'GET', body, cookie, requestOrigin = origin) =>
  fetch(`${origin}/api/admin/sales${path}`, {
    method,
    headers: { Origin: requestOrigin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
async function signin(role) {
  const response = await fetch(`${origin}/api/auth/signin`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `${role.toLowerCase()}@example.test`,
      password: 'safe-password-123',
      acceptTerms: true,
    }),
  });
  assert.equal(response.status, 200);
  return response.headers
    .getSetCookie()
    .map((item) => item.split(';')[0])
    .join('; ');
}
const createInput = (email) => ({
  request_key: randomUUID(),
  email,
  name: 'Lê Minh Khôi',
  phone: '0987654321',
  password: 'Demo-password-123!',
  confirmPassword: 'Demo-password-123!',
});
try {
  stack = await startStack(
    3240,
    {
      SUPABASE_URL: 'http://127.0.0.1:3241',
      SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key',
      SUPABASE_SECRET_KEY: secret,
    },
    { build: !process.argv.includes('--no-build') },
  );
  let ready = false,
    output = '';
  for (const stream of [stack.app.stdout, stack.app.stderr])
    stream.on('data', (chunk) => {
      output += chunk;
    });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${origin}/sign-in`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(250);
  }
  assert.ok(ready, output);
  const cookie = await signin('Admin'),
    salesCookie = await signin('Sales'),
    userCookie = await signin('User');
  for (const [actor, expected] of [
    [undefined, 401],
    [salesCookie, 403],
    [userCookie, 403],
  ]) {
    for (const [path, method, body] of [
      ['', 'GET'],
      ['', 'POST', createInput('denied@example.test')],
      [`/${ids.Sales}`, 'GET'],
      [`/${ids.Sales}`, 'PATCH', {}],
      [`/${ids.Sales}/status`, 'POST', {}],
      [`/${ids.Sales}/history`, 'GET'],
    ])
      check((await api(path, method, body, actor)).status === expected, `${method} ${path} denied for non-Admin`);
    const page = await fetch(`${origin}/admin/sales`, { headers: actor ? { Cookie: actor } : {}, redirect: 'manual' });
    check(
      page.status === 307 && page.headers.get('location')?.includes(actor ? '/forbidden' : '/sign-in'),
      'SSR Admin access enforced',
    );
  }
  const pageResponse = await fetch(`${origin}/admin/sales`, { headers: { Cookie: cookie }, redirect: 'manual' });
  const html = await pageResponse.text();
  if (pageResponse.status >= 500) console.error(output);
  check(
    html.includes('Quản lý nhân viên Sales') && !html.includes(secret),
    `Admin page rendered without server key (${pageResponse.status}, ${pageResponse.headers.get('location')}, ${html.slice(0, 250)})`,
  );
  check(
    (await api('', 'POST', createInput('blocked@example.test'), cookie, 'https://other.example')).status === 403,
    'Cross-origin writes denied',
  );
  for (const query of ['?status=Admin', '?page=-1', '?pageSize=500', '?q=a&q=b', '?role=Admin'])
    check((await api(query, 'GET', undefined, cookie)).status === 400, 'Invalid list filter denied');
  check((await api('/invalid-id', 'GET', undefined, cookie)).status === 400, 'Malformed id denied');
  for (const id of [ids.Admin, ids.User])
    check((await api(`/${id}`, 'GET', undefined, cookie)).status === 404, 'Non-Sales target excluded');
  let result = await (await api('?status=active', 'GET', undefined, cookie)).json();
  check(result.total === 1 && result.stats.total === 2, 'Status filter and totals');
  result = await (await api('?q=Minh', 'GET', undefined, cookie)).json();
  check(result.total === 1, 'Name search');
  check(
    (await api('', 'POST', { ...createInput('forged@example.test'), role: 'Admin' }, cookie)).status === 400,
    'Role injection denied',
  );
  const input = createInput('new-sales@example.test'),
    created = await api('', 'POST', input, cookie);
  check(created.status === 201, `Sales created (${created.status}: ${await created.clone().text()})`);
  const createdBody = await created.json();
  check(
    createdBody.item.phone === '+84987654321' && createdBody.item.status === 'active',
    'Phone normalized and account activated',
  );
  const calls = createCalls;
  check((await api('', 'POST', input, cookie)).status === 200 && createCalls === calls, 'Retry is idempotent');
  check((await api('', 'POST', { ...input, name: 'Tên khác' }, cookie)).status === 409, 'Changed retry payload denied');
  check((await api('', 'POST', createInput(input.email), cookie)).status === 409, 'Duplicate email has field error');
  commitThenError = true;
  check(
    (await api('', 'POST', createInput('timeout@example.test'), cookie)).status === 201,
    'Committed Auth error recovered using request UUID',
  );
  commitThenError = false;
  failActivation = true;
  const pending = createInput('pending@example.test');
  check(
    (await api('', 'POST', pending, cookie)).status === 503 && rows.get(pending.request_key).status === 'suspended',
    'Interrupted activation leaves safe pending account',
  );
  failActivation = false;
  check(
    (
      await api(
        `/${pending.request_key}/status`,
        'POST',
        { status: 'active', version: 1, reason: 'Khôi phục tạo tài khoản' },
        cookie,
      )
    ).status === 200,
    'Pending account can be activated from list',
  );
  const update = {
    name: 'Nguyễn Minh Anh',
    phone: '0901234567',
    version: 0,
    profile_version: 0,
    reason: 'Cập nhật thông tin nhân sự',
  };
  check(
    (await api(`/${ids.Sales}`, 'PATCH', { ...update, email: 'override@example.test' }, cookie)).status === 400,
    'Login identity cannot be patched',
  );
  let response = await api(`/${ids.Sales}`, 'PATCH', update, cookie);
  check(response.status === 200 && (await response.json()).phone === '+84901234567', 'Update name and phone');
  check((await api(`/${ids.Sales}`, 'PATCH', update, cookie)).status === 409, 'Stale update rejected');
  check(
    (await api(`/${ids.Sales}`, 'PATCH', { ...update, version: 1, profile_version: 0 }, cookie)).status === 409,
    'Concurrent self profile update rejected',
  );
  socket = io('http://127.0.0.1:3242', {
    transports: ['websocket'],
    extraHeaders: { Origin: origin, Cookie: salesCookie },
    reconnection: false,
  });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    setTimeout(() => reject(new Error('Socket connect timeout')), 5000).unref();
  });
  await new Promise((resolve, reject) => {
    socket.once('message', resolve);
    socket.emit('message', {});
    setTimeout(() => reject(new Error('Socket message timeout')), 5000).unref();
  });
  const disconnected = new Promise((resolve, reject) => {
    socket.once('disconnect', resolve);
    setTimeout(() => reject(new Error('Suspended Sales socket remained connected')), 5000).unref();
  });
  check(
    (
      await api(
        `/${ids.Sales}/status`,
        'POST',
        { status: 'suspended', version: 1, reason: 'Tạm ngưng công việc' },
        cookie,
      )
    ).status === 200,
    'Suspend Sales',
  );
  await disconnected;
  check(!socket.connected, 'Existing socket disconnected');
  check(
    (await fetch(`${origin}/api/auth/me`, { headers: { Cookie: salesCookie } })).status === 401,
    'Suspended session cannot access app',
  );
  check(
    (await api(`/${ids.Sales}/status`, 'POST', { status: 'active', version: 2, reason: 'Tiếp tục công việc' }, cookie))
      .status === 200,
    'Reactivate Sales',
  );
  check(
    (await fetch(`${origin}/api/auth/me`, { headers: { Cookie: salesCookie } })).status === 401,
    'Reactivation does not restore revoked session',
  );
  check(
    (await fetch(`${origin}/api/auth/me`, { headers: { Cookie: await signin('Sales') } })).ok,
    'New Sales sign-in works',
  );
  response = await api(`/${ids.Sales}/history`, 'GET', undefined, cookie);
  const history = await response.json();
  check(
    history.total === 3 &&
      history.items[2].before_data.name === 'Nguyễn Minh An' &&
      history.items[2].after_data.name === update.name,
    'Audit retains before/after, actor and reason',
  );
  check(
    !JSON.stringify(history).includes('password') && !JSON.stringify(history).includes('fingerprint'),
    'Audit contains no credentials',
  );
  check((await api(`/${ids.Sales}/history?page=2`, 'GET', undefined, cookie)).status === 200, 'History pagination');
  check(
    (await api(`/${ids.Sales}/history?page=-1`, 'GET', undefined, cookie)).status === 400,
    'History invalid page denied',
  );
  users.get(ids.Admin).app_metadata.role = 'User';
  check((await api('', 'GET', undefined, cookie)).status === 403, 'Current trusted role checked after downgrade');
  console.log(`Sales HTTP integration: ${checks} checks passed.`);
  if (process.argv.includes('--preview')) {
    seed();
    console.log(`Isolated Sales preview: ${origin}/sign-in — admin@example.test / safe-password-123`);
    await new Promise((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
  }
} finally {
  socket?.disconnect();
  await stack?.close();
  await new Promise((resolve) => provider.close(resolve));
}
