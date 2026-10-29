// From frontend/: build backend and frontend, set PGLITE_PATH, then
// node scripts/test-campaign-realtime.mjs. Uses disposable fixtures on 3400–3403.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { stopProcess } from './campaign-test-process.mjs';

const origin = 'http://localhost:3400',
  id = 'f7900000-0000-4000-8000-000000000002';
const cron = 'm07-cron-secret-with-at-least-32-characters';
let server,
  checks = 0;
const sockets = [];
const check = (value, label) => {
  assert.ok(value, label);
  checks++;
};
const call = (path, method = 'GET', body) =>
  fetch(origin + '/api/admin/campaigns' + path, {
    method,
    headers: { Cookie: 'pose-access=fixture-admin', Origin: origin, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
async function connect(token) {
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/socket.io?EIO=4&transport=websocket');
  sockets.push(ws);
  const events = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Realtime authentication timed out')), 5000);
    ws.onerror = () => {
      clearTimeout(timer);
      reject(Error('Realtime connection failed'));
    };
    ws.onmessage = ({ data }) => {
      const frame = String(data);
      if (frame.startsWith('0')) ws.send('40' + JSON.stringify({ token }));
      else if (frame.startsWith('40')) {
        clearTimeout(timer);
        resolve();
      } else if (frame.startsWith('44')) {
        clearTimeout(timer);
        reject(Error(frame));
      } else if (frame === '2') ws.send('3');
      else if (frame.startsWith('42')) events.push(JSON.parse(frame.slice(2)));
    };
  });
  return events;
}
try {
  let output = '';
  server = spawn(process.execPath, ['scripts/test-campaign-management.mjs', '--preview-only'], {
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
  check(output.includes('PREVIEW READY:'), 'isolated fixture ready: ' + output);
  for (const role of ['sales', 'user']) {
    const r = await fetch(origin + '/api/admin/campaigns/scheduler', {
      headers: { Cookie: 'pose-access=fixture-' + role },
    });
    check(r.status === 403, role + ' scheduler denied');
  }
  const status = await call('/scheduler');
  check(status.ok, 'Admin scheduler available');
  check(
    JSON.stringify(Object.keys(await status.json()).sort()) ===
      JSON.stringify(['redis', 'repeatEvery', 'lastRunAt', 'lastResult', 'lastError'].sort()),
    'scheduler response fields',
  );
  const edit = await call('/' + id, 'PATCH', {
    version: 0,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    window_start: '00:00',
    window_end: '23:59',
  });
  check(edit.ok, 'fixture call window');
  const campaign = (await edit.json()).item;
  const action = await call('/' + id + '/action', 'POST', { version: campaign.version, action: 'start' });
  check(action.ok, 'fixture campaign started');
  const admin = await connect('fixture-admin'),
    sales = await connect('fixture-sales'),
    user = await connect('fixture-user');
  const tick = () =>
    fetch(origin + '/api/system/campaigns/tick', { method: 'POST', headers: { Authorization: 'Bearer ' + cron } });
  const response = await tick();
  check(response.ok, 'manual tick through Nest proxy');
  assert.deepEqual(await response.json(), { item: { jobs_created: 1 } });
  checks++;
  for (let i = 0; i < 50 && !admin.some((e) => e[0] === 'campaign.progress' && e[1].campaignIds.includes(id)); i++)
    await delay(100);
  check(
    admin.some((e) => e[0] === 'campaign.progress' && e[1].campaignIds.includes(id)),
    'real SQL tick emits changed campaign to Admin',
  );
  await delay(100);
  check(sales.length === 0 && user.length === 0, 'Sales and User receive no campaign event');
  const progress = await call('/' + id + '/progress');
  check((await progress.json()).item.memberships.QUEUED === 1, 'event matches committed membership');
  const previous = admin.length;
  assert.deepEqual(await (await tick()).json(), { item: { jobs_created: 0 } });
  checks++;
  await delay(200);
  check(admin.length === previous, 'unchanged tick emits no duplicate progress');
  const latest = await (await call('/scheduler')).json();
  check(
    latest.redis === false && latest.lastRunAt && latest.lastError === null && latest.lastResult.jobs_created === 0,
    'manual scheduler state with Redis unavailable',
  );
  console.log(
    `PASS: ${checks} M07 realtime/proxy/SQL checks; Admin events, role isolation, unchanged ticks and manual scheduler status.`,
  );
} finally {
  for (const ws of sockets) ws.close();
  await stopProcess(server, { graceful: true });
}
