import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { stopProcess } from './campaign-test-process.mjs';
const candidates = [
  process.env.CHROME_PATH,
  process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
].filter(Boolean);
let chrome;
for (const p of candidates) {
  try {
    await access(p);
    chrome = p;
    break;
  } catch {}
}
assert.ok(chrome, 'Chrome executable required');
const root = join(tmpdir(), 'pose-m06-dashboard');
await mkdir(root, { recursive: true });
let server, child, ws;
try {
  let out = '';
  server = spawn(process.execPath, ['scripts/test-ai-agent.mjs', '--preview-only'], {
    cwd: new URL('..', import.meta.url),
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  server.stdout.on('data', (x) => (out += x));
  for (let i = 0; i < 150 && !out.includes('PREVIEW READY:'); i++) await delay(100);
  assert.ok(out.includes('PREVIEW READY:'), out);
  child = spawn(
    chrome,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--remote-debugging-port=3307',
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
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data),
      p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (e) =>
    (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
  const wait = async (e) => {
    for (let i = 0; i < 120; i++) {
      if (await evaluate(e)) return;
      await delay(50);
    }
    throw Error('Timed out: ' + e);
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(root, name + '.png'), Buffer.from(r.data, 'base64'));
  };
  await send('Page.enable'); // Real data: one chat turn through the fixture stack, then the dashboard reads the real endpoints.
  const seeded = await fetch('http://localhost:3300/api/ai/chat', {
    method: 'POST',
    headers: { Origin: 'http://localhost:3300', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Tôi muốn tìm căn hộ, gọi 0901234567', store_transcript: false, history: [] }),
  });
  assert.equal(seeded.status, 200, 'seed chat turn');
  const localFixture = await fetch('http://localhost:3301/fixture/seed-ai-local', { method: 'POST' });
  assert.equal(localFixture.status, 200, 'seed local model row');
  await delay(500);
  await send('Network.setCookie', { name: 'pose-access', value: 'fixture-Admin', url: 'http://localhost:3300' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:3300/admin/ai-dashboard' });
  await delay(700);
  await wait("document.querySelector('h1')?.textContent.includes('AI Platform Dashboard')");
  assert.ok(await evaluate("document.body.innerText.includes('Hôm nay')"));
  await wait("document.querySelector('.ai-dash-note')?.textContent.includes('24/10/2026')");
  await wait("!!document.querySelector('.ai-dash-models tbody tr')");
  assert.ok(await evaluate("document.body.innerText.includes('OpenAI') && document.body.innerText.includes('Local')"));
  assert.ok(await evaluate("document.body.innerText.includes('Tổng OpenAI')"), 'OpenAI total row shown');
  const fixtureLogs = await (await fetch('http://localhost:3301/fixture/ai-request-logs')).json();
  const provider = (model) => {
    const value = String(model || '')
      .trim()
      .toLowerCase();
    if (value === 'deterministic') return 'Deterministic';
    if (value.startsWith('gpt-') || value.startsWith('o') || value.startsWith('text-embedding-3-')) return 'OpenAI';
    return 'Local';
  };
  const openAiLogs = fixtureLogs.filter((row) => provider(row.p_model) === 'OpenAI');
  const overviewResponse = await fetch('http://localhost:3300/api/admin/ai-dashboard/overview', {
    headers: { Cookie: 'pose-access=fixture-Admin' },
  });
  const overview = await overviewResponse.json();
  assert.equal(overviewResponse.status, 200);
  for (const row of overview.items) {
    assert.equal(Number(row.calls), openAiLogs.length, 'overview calls use OpenAI rows');
    assert.equal(
      Number(row.total_tokens),
      openAiLogs.reduce((sum, log) => sum + Number(log.p_total_tokens || 0), 0),
    );
    assert.equal(
      Number(row.total_tokens),
      fixtureLogs.reduce((sum, log) => sum + Number(log.p_total_tokens || 0), 0) -
        fixtureLogs
          .filter((log) => provider(log.p_model) === 'Local')
          .reduce((sum, log) => sum + Number(log.p_total_tokens || 0), 0),
      'overview excludes local tokens',
    );
  }
  await shot('dashboard-1280');
  await evaluate("document.querySelector('.ai-dash-segmented button:nth-child(2)').click()");
  await wait(
    "document.querySelector('.ai-dash-segmented button:nth-child(2)').getAttribute('aria-pressed')==='true' && !!document.querySelector('.ai-dash-chart svg rect')",
  );
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'no horizontal page overflow at 1280');
  await wait("!!document.querySelector('.ai-dash-expand')");
  await evaluate("document.querySelector('.ai-dash-expand').click()");
  await wait("document.querySelectorAll('.ai-dash-calls tbody tr').length>0");
  assert.ok(
    await evaluate("document.querySelector('.ai-dash-expand').getAttribute('aria-expanded')==='true'"),
    'row expands',
  );
  assert.ok(
    await evaluate(
      "document.body.innerText.includes('Tôi muốn tìm căn hộ') && !document.body.innerText.includes('0901234567')",
    ),
    'question preview shown without the phone number',
  );
  await send('Emulation.setDeviceMetricsOverride', { width: 380, height: 900, deviceScaleFactor: 1, mobile: true });
  await send('Page.reload');
  await delay(500);
  await wait("document.querySelector('h1')?.textContent.includes('AI Platform Dashboard')");
  await wait("!!document.querySelector('.ai-dash-expand')");
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'no horizontal page overflow at 380');
  await shot('dashboard-380');
  console.log('PASS: M06 dashboard UI checks at 1280px and 380px; bucket switching and per-call expansion.');
  console.log(`Screenshots: ${root}`);
} finally {
  ws?.close();
  if (child) await stopProcess(child, { tree: true });
  if (server) await stopProcess(server, { graceful: true });
}
