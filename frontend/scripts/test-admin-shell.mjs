// Admin shell + listing grid checks against the fixture discovery preview (Admin role). Run after `next build`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { stopProcess } from './campaign-test-process.mjs';

let chrome;
for (const candidate of [
  process.env.CHROME_PATH,
  process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
].filter(Boolean)) {
  try {
    await access(candidate);
    chrome = candidate;
    break;
  } catch {}
}
assert.ok(chrome, 'Chrome executable required');
const root = join(tmpdir(), 'pose-admin-shell');
await mkdir(root, { recursive: true });
const routes = [
  '/admin?kind=properties',
  '/admin?kind=projects',
  '/admin?kind=subdivisions',
  '/admin/inquiries',
  '/admin/leads',
  '/admin/reports',
  '/admin/appointments',
  '/admin/campaigns',
  '/admin/calls',
  '/admin/ai-dashboard',
  '/admin/sales',
];
const order = [
  'Không gian Sales',
  'Sản phẩm',
  'Dự án',
  'Phân khu',
  'Yêu cầu tư vấn',
  'Quản lý Lead',
  'Báo cáo Lead',
  'Lịch hẹn',
  'Chiến dịch gọi',
  'Cuộc gọi',
  'AI Platform',
  'Quản lý Sales',
];
let server,
  child,
  ws,
  send,
  checks = 0;
const problems = [];
let current = '';
const check = (value, label) => {
  assert.ok(value, label);
  checks++;
};
try {
  let output = '';
  server = spawn(process.execPath, ['scripts/test-discovery.mjs', '--preview', '--preview-admin', '--no-build'], {
    cwd: new URL('..', import.meta.url),
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  server.stdout.on('data', (x) => (output += x));
  server.stderr.on('data', (x) => (output += x));
  for (let i = 0; i < 1800 && !output.includes('PREVIEW READY:'); i++) {
    if (server.exitCode !== null) break;
    await delay(100);
  }
  assert.ok(output.includes('PREVIEW READY:'), output);
  const origin = output.match(/PREVIEW READY: (\S+);/)[1];
  child = spawn(
    chrome,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--disable-background-networking',
      '--no-proxy-server',
      '--remote-debugging-port=3307',
      '--window-size=1440,900',
      `--user-data-dir=${join(root, 'chrome-' + Date.now())}`,
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  let target;
  for (let i = 0; i < 60; i++) {
    try {
      target = await (await fetch('http://127.0.0.1:3307/json/new?about:blank', { method: 'PUT' })).json();
      if (target.webSocketDebuggerUrl) break;
    } catch {}
    await delay(100);
  }
  assert.ok(target?.webSocketDebuggerUrl);
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let next = 0;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(Error(JSON.stringify(m.error)));
      else p.resolve(m.result);
    }
  });
  send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(Error(method + ' timeout'));
        }, 15000);
      pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const wait = async (condition, label = condition) => {
    for (let i = 0; i < 300; i++) {
      try {
        if (await evaluate(condition)) return;
      } catch {}
      await delay(50);
    }
    throw Error('Timed out: ' + label + ' at ' + (await evaluate('location.href')));
  };
  const open = async (path) => {
    current = path;
    await send('Page.navigate', { url: origin + path });
    await wait(`document.readyState==='complete'&&location.href===${JSON.stringify(origin + path)}`);
  };
  // Console errors, uncaught exceptions and React hydration warnings, tagged with the page that produced them.
  ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
      problems.push(
        current +
          ': console.' +
          m.params.type +
          ' ' +
          m.params.args
            .map((a) => a.value ?? a.description ?? '')
            .join(' ')
            .slice(0, 300),
      );
    if (m.method === 'Runtime.exceptionThrown')
      problems.push(
        current +
          ': exception ' +
          (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300),
      );
    // The fixture has no realtime server; M08 calls connect straight to the build-time NEXT_PUBLIC_API_URL.
    if (
      m.method === 'Log.entryAdded' &&
      m.params.entry.level === 'error' &&
      !/\/socket\.io\?/.test((m.params.entry.url || '') + ' ' + m.params.entry.text)
    )
      problems.push(current + ': log ' + m.params.entry.text.slice(0, 200) + ' ' + (m.params.entry.url || ''));
  });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  // The discovery fixture has no M04/M11 routes; answer them in their real shapes.
  const stubs = [
    [
      /\/api\/admin\/sales\?/,
      { items: [], total: 0, page: 1, pageSize: 20, stats: { total: 0, active: 0, suspended: 0 } },
    ],
    [/\/api\/leads\/options/, { sales: [] }],
    [/\/api\/leads\/property-owners/, { items: [], total: 0, page: 1, pageSize: 20 }],
    [
      /\/api\/leads\?/,
      {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        stats: { total: 0, hot: 0, warm: 0, cold: 0, unrated: 0, unassigned: 0 },
      },
    ],
    [/\/api\/appointments\/options(?:\?|$)/, { items: [] }],
    [/\/api\/appointments\?/, { items: [], total: 0, page: 1, pageSize: 12, role: 'Admin' }],
    [/\/api\/reports\/options(?:\?|$)/, { role: 'Admin', sales: [] }],
    [
      /\/api\/reports\/leads\?/,
      {
        stats: { total: 0, converted: 0, unassigned: 0 },
        statuses: [
          { key: 'NEW', count: 0 },
          { key: 'CONTACTED', count: 0 },
          { key: 'QUALIFIED', count: 0 },
          { key: 'FOLLOW_UP', count: 0 },
          { key: 'CONVERTED', count: 0 },
          { key: 'LOST', count: 0 },
        ],
        temperatures: [
          { key: 'HOT', count: 0 },
          { key: 'WARM', count: 0 },
          { key: 'COLD', count: 0 },
          { key: 'UNRATED', count: 0 },
        ],
        trend: [],
        bucket: 'day',
        timezone: 'Asia/Ho_Chi_Minh',
        generated_at: '2026-10-26T00:00:00.000Z',
        filters: { date_from: '2026-10-01', date_to: '2026-10-26', archived: 'all' },
        scope: { role: 'Admin' },
      },
    ],
  ];
  ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.method !== 'Fetch.requestPaused') return;
    const body = stubs.find(([pattern]) => pattern.test(m.params.request.url))?.[1];
    void send(
      body ? 'Fetch.fulfillRequest' : 'Fetch.continueRequest',
      body
        ? {
            requestId: m.params.requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
            body: Buffer.from(JSON.stringify(body)).toString('base64'),
          }
        : { requestId: m.params.requestId },
    );
  });
  await send('Fetch.enable', {
    patterns: [
      { urlPattern: '*/api/admin/sales?*', requestStage: 'Request' },
      { urlPattern: '*/api/leads*', requestStage: 'Request' },
      { urlPattern: '*/api/appointments*', requestStage: 'Request' },
      { urlPattern: '*/api/reports*', requestStage: 'Request' },
    ],
  });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await open('/');
  await wait(
    `document.querySelectorAll('[class*="propertyCard"] a[href^="/properties/"]').length>0`,
    'catalog listings on the landing',
  );
  const landing = await evaluate(
    `[...document.querySelectorAll('[class*="propertyCard"]')].map(card=>!!card.querySelector('img'))`,
  );
  check(landing.length === 12, `Landing shows 12 listings (got ${landing.length})`);
  check(landing.some(Boolean), 'Landing listing with a cover shows its photo');
  await wait(`!!document.querySelector('.ai-launcher, .ai-panel')`, 'landing AI chat');
  check(true, 'Landing shows the small AI chat');
  // Hover menus: travelling from the trigger across the gap into the panel keeps it open.
  const move = async (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const box = await evaluate(
    `(()=>{const t=document.querySelector('.property-menu-trigger').getBoundingClientRect();return {x:t.left+t.width/2,top:t.top,bottom:t.bottom};})()`,
  );
  await move(box.x, (box.top + box.bottom) / 2);
  await wait(`!!document.querySelector('.property-menu-panel')`, 'property menu opens on hover');
  const panel = await evaluate(
    `(()=>{const p=document.querySelector('.property-menu-panel').getBoundingClientRect();return {top:p.top};})()`,
  );
  await move(box.x, (box.bottom + panel.top) / 2);
  await delay(120);
  await move(box.x, panel.top + 20);
  await delay(400);
  check(
    await evaluate(`!!document.querySelector('.property-menu-panel')`),
    'Property menu stays open while the pointer crosses the gap',
  );
  await move(5, 600);
  await delay(500);
  check(
    await evaluate(`!document.querySelector('.property-menu-panel')`),
    'Property menu closes after the pointer leaves',
  );
  for (const path of ['/properties/fe200000-0000-4000-8000-000000000001', '/tro-ly-ai', '/sign-in', '/consultation']) {
    await open(path);
    await delay(1500);
  }
  await open('/properties');
  await wait(`document.querySelectorAll('.discovery-card').length>0`, 'search cards');
  const found = await evaluate(`document.querySelectorAll('.discovery-card').length`);
  check(found === 12, `Search shows 12 listings per page (got ${found})`);

  const signed = await evaluate(
    `fetch('/api/auth/signin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'minhanh@example.test',password:'safe-password-123'})}).then(r=>r.status)`,
  );
  check(signed === 200, `Admin fixture signs in (${signed})`);
  await open('/');
  await wait(`!!document.querySelector('.account-trigger')`, 'account menu on the homepage');
  await evaluate(`document.querySelector('.account-trigger').click()`);
  await wait(`!!document.querySelector('.account-menu')`, 'account menu opens');
  const menu = await evaluate(
    `[...document.querySelectorAll('.account-menu [role=menuitem]')].map(a=>a.textContent.trim()+'>'+(a.getAttribute('href')||''))`,
  );
  check(
    menu.includes('Admin dashboard>/admin') &&
      menu.includes('Không gian Sales>/sales') &&
      !menu.some((item) => item.startsWith('Quản lý Lead')),
    `Admin account menu links to both workspaces (${menu.join(', ')})`,
  );
  check(
    !(await evaluate(`document.querySelector('.account-trigger').textContent`)).includes('Tài khoản'),
    'Account menu shows the user name',
  );
  for (const route of routes) {
    await open(route);
    await wait(`!!document.querySelector('.admin-sidebar')`, route + ' sidebar');
    if (route === routes[0])
      check(
        await evaluate(`document.querySelector('.admin-sidebar a[href="/sales"]')?.getAttribute('href')==='/sales'`),
        'Admin sidebar switches to the Sales workspace',
      );
    const shape = await evaluate(
      `({sidebars:document.querySelectorAll('.admin-sidebar').length,legacy:document.querySelectorAll('.catalog-sidebar:not(.admin-sidebar)').length,topbars:document.querySelectorAll('.catalog-topbar').length,items:[...document.querySelectorAll('.admin-sidebar nav a')].map(a=>a.textContent.replace(/\\d+/g,'').trim()),active:[...document.querySelectorAll('.admin-sidebar nav a[aria-current="page"]')].map(a=>a.getAttribute('href'))})`,
    );
    check(
      shape.sidebars === 1 && shape.legacy === 0 && shape.topbars === 1,
      `${route}: one sidebar and one header strip ${JSON.stringify(shape)}`,
    );
    check(
      JSON.stringify(shape.items) === JSON.stringify(order),
      `${route}: sidebar items in order (${shape.items.join(', ')})`,
    );
    check(shape.active.length === 1 && shape.active[0] === route, `${route}: active item ${shape.active.join(',')}`);
  }
  await open('/admin?kind=properties');
  await wait(`!!document.querySelector('.admin-sidebar')`);
  await evaluate(
    `window.__sidebar=document.querySelector('.admin-sidebar');document.querySelector('.admin-sidebar a[href="/admin/campaigns"]').click()`,
  );
  await wait(`location.pathname==='/admin/campaigns'`);
  check(
    await evaluate(`window.__sidebar?.isConnected&&window.__sidebar===document.querySelector('.admin-sidebar')`),
    'Sidebar node survives section change',
  );
  await evaluate(`document.querySelector('.admin-sidebar a[href="/admin?kind=projects"]').click()`);
  await wait(
    `location.search==='?kind=projects'&&document.querySelector('.admin-sidebar a[aria-current="page"]')?.getAttribute('href')==='/admin?kind=projects'`,
  );
  check(await evaluate(`window.__sidebar?.isConnected`), 'Sidebar node survives return to the catalog');
  for (const href of ['/admin/reports', '/admin/appointments', '/admin/leads']) {
    await evaluate(`document.querySelector('.admin-sidebar a[href="${href}"]').click()`);
    await wait(
      `location.pathname==='${href}'&&document.querySelector('.admin-sidebar a[aria-current="page"]')?.getAttribute('href')==='${href}'`,
      href + ' active in admin shell',
    );
    check(await evaluate(`window.__sidebar?.isConnected`), `${href} keeps the admin sidebar`);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 560, deviceScaleFactor: 1, mobile: false });
  await delay(300);
  const scroll = await evaluate(
    `(()=>{const s=document.querySelector('.admin-sidebar');s.scrollTop=s.scrollHeight;const last=document.querySelector('.admin-sidebar .catalog-sidebar-bottom').getBoundingClientRect();const nav=document.querySelector('.admin-sidebar nav a[href="/admin/leads"]').getBoundingClientRect().height;const sw=document.querySelector('.admin-sidebar nav a[href="/sales"]').getBoundingClientRect().height;const bottom=document.querySelector('.admin-sidebar .catalog-sidebar-bottom a').getBoundingClientRect().height;return {sw,overflow:getComputedStyle(s).overflowY,scrolled:s.scrollTop>0,page:scrollY,lastVisible:last.bottom<=innerHeight+1,nav,bottom};})()`,
  );
  check(
    scroll.overflow === 'auto' && scroll.scrolled && scroll.page === 0 && scroll.lastVisible,
    `Short screen: admin sidebar scrolls on its own ${JSON.stringify(scroll)}`,
  );
  check(
    Math.abs(scroll.nav - scroll.bottom) <= 1 && Math.abs(scroll.nav - scroll.sw) <= 1,
    `Profile and home links are the same size as the menu items ${JSON.stringify(scroll)}`,
  );
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 1, mobile: true });
  await delay(300);
  check(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), 'No horizontal overflow at 375px');
  await evaluate(`document.querySelector('.admin-menu-button').click()`);
  await wait(`!!document.querySelector('.admin-sidebar.is-open')`, 'drawer opens');
  check(true, 'Menu button opens the drawer');
  await delay(1000);
  check(problems.length === 0, 'No console errors, exceptions or hydration warnings:\n' + problems.join('\n'));
  console.log(`PASS: ${checks} admin shell checks; guest pages and admin sections have no console errors.`);
} finally {
  if (send && ws?.readyState === WebSocket.OPEN) {
    try {
      await send('Browser.close');
    } catch {}
  }
  if (child) await stopProcess(child);
  if (server) await stopProcess(server);
}
