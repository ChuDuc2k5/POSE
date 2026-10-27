import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function runSearchFiltersUI(origin) {
  const screenshots = join(tmpdir(), 'pose-search-filters-ui');
  await mkdir(screenshots, { recursive: true });
  const profile = await mkdtemp(join(tmpdir(), 'pose-search-chrome-'));
  const chrome = spawn(
    process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=3510',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let chromeOutput = '';
  chrome.stderr.on('data', (chunk) => {
    chromeOutput += chunk;
  });
  let ws,
    checks = 0,
    id = 0;
  const pending = new Map();
  const check = (condition, message) => {
    assert.ok(condition, message);
    checks++;
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(() => {
        pending.delete(key);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      pending.set(key, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      ws.send(JSON.stringify({ id: key, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const wait = async (expression) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`UI timeout: ${expression}`);
  };
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const choose = (text) =>
    evaluate(
      `Array.from(document.querySelectorAll('#search-filter-panel button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`,
    );
  const input = (name, value) =>
    evaluate(
      `(()=>{const e=document.querySelector('[name="${name}"]');const setter=Object.getOwnPropertyDescriptor(e.tagName==='SELECT' ? HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT' ? 'change':'input',{bubbles:true}));})()`,
    );
  const apply = async () => {
    await choose('Áp dụng');
    await wait(
      `!document.querySelector('#search-filter-panel') && document.querySelector('.property-results').getAttribute('aria-busy')==='false'`,
    );
  };
  const open = async (name) => {
    await click(`#filter-${name}`);
    await wait(`!!document.querySelector('#search-filter-panel')`);
    check(
      await evaluate(`document.querySelector('#filter-${name}').getAttribute('aria-expanded')==='true'`),
      `${name} expanded`,
    );
  };
  const screenshot = async (name) => {
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const path = join(screenshots, name);
    await writeFile(path, Buffer.from(result.data, 'base64'));
    console.log(`SCREENSHOT: ${path}`);
  };
  try {
    let target;
    for (let i = 0; i < 80; i++) {
      if (chrome.exitCode !== null) break;
      try {
        target = (await (await fetch('http://127.0.0.1:3510/json', { signal: AbortSignal.timeout(1000) })).json()).find(
          (t) => t.type === 'page',
        );
        if (target) break;
      } catch {}
      await delay(100);
    }
    assert.ok(target, `Headless Chrome started: ${chromeOutput}`);
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await once(ws, 'open');
    ws.addEventListener('message', (event) => {
      const result = JSON.parse(event.data);
      if (result.id) {
        const p = pending.get(result.id);
        pending.delete(result.id);
        if (result.error) p?.reject(new Error(JSON.stringify(result.error)));
        else p?.resolve(result.result);
      }
    });
    await send('Page.enable');
    await send('Runtime.enable');
    for (const width of [1280, 380]) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: width === 380,
      });
      await send('Page.navigate', { url: `${origin}/properties` });
      await wait(
        `document.querySelector('.property-results')?.getAttribute('aria-busy')==='false' && !!document.querySelector('#filter-price')`,
      );
      check(
        await evaluate(
          `(()=>{const active=[...document.querySelectorAll('.site-header nav [aria-current="page"]')];return active.length===1&&active[0].textContent.includes('Bất động sản');})()`,
        ),
        'Properties has only the real-estate nav item active',
      );
      check(await evaluate(`document.documentElement.scrollWidth<=${width}`), `${width} no page overflow`);
      check(await evaluate(`!document.body.textContent.includes('Lưu tìm kiếm')`), 'No saved-search control');
      for (const name of ['transaction', 'price', 'bedrooms', 'type', 'more']) {
        await open(name);
        check(
          await evaluate(
            `(()=>{const r=document.querySelector('#search-filter-panel').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight+1;})()`,
          ),
          'Panel stays inside viewport',
        );
        check(
          await evaluate(`document.querySelector('#search-filter-panel').contains(document.activeElement)`),
          'Initial panel focus',
        );
        await evaluate(
          `Array.from(document.querySelectorAll('#search-filter-panel button,input,select')).at(-1).focus()`,
        );
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        check(
          await evaluate(`document.querySelector('#search-filter-panel').contains(document.activeElement)`),
          'Tab trapped',
        );
        await send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
        });
        await wait(`!document.querySelector('#search-filter-panel')`);
        check(await evaluate(`document.activeElement.id==='filter-${name}'`), 'Escape restores trigger focus');
        await open(name);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 2, y: 2, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 2, y: 2, button: 'left', clickCount: 1 });
        await wait(`!document.querySelector('#search-filter-panel')`);
        check(true, 'Outside click closes');
      }
      await open('transaction');
      await choose('Cho thuê');
      await wait(
        `location.search.includes('transaction=Rent') && document.querySelector('.property-results').getAttribute('aria-busy')==='false'`,
      );
      check(
        await evaluate(
          `document.querySelector('#filter-transaction').textContent.includes('Cho thuê') && document.querySelector('.property-results-top').textContent.includes('Bất động sản cho thuê')`,
        ),
        'Rental button and title',
      );
      check(
        await evaluate(
          `document.querySelector('.property-card-bottom').textContent.includes('/tháng') && document.querySelector('.transaction-pill').textContent==='Cho thuê'`,
        ),
        'Rental card format',
      );
      await open('price');
      check(
        await evaluate(`document.querySelector('#search-filter-panel').textContent.includes('VND/tháng')`),
        'Monthly input units',
      );
      await choose('10–15tr');
      await apply();
      check(
        await evaluate(
          `new URLSearchParams(location.search).get('minPrice')==='10000000' && document.querySelector('#filter-price').textContent.includes('10–15tr')`,
        ),
        'Rent range query and label',
      );
      await open('transaction');
      await choose('Mua bán');
      await wait(`location.search.includes('transaction=Sale') && !location.search.includes('minPrice')`);
      check(true, 'Changing transaction clears incompatible prices');
      await open('price');
      await choose('3–5 tỷ');
      await apply();
      check(
        await evaluate(
          `new URLSearchParams(location.search).get('maxPrice')==='5000000000' && document.querySelector('#filter-price').textContent.includes('3–5 tỷ')`,
        ),
        'Sale range query and label',
      );
      await open('bedrooms');
      await choose('2+');
      await apply();
      check(
        await evaluate(
          `location.search.includes('bedrooms=2') && document.querySelector('#filter-bedrooms').textContent.includes('2+ PN')`,
        ),
        'Bedroom query and label',
      );
      await open('type');
      await choose('Căn hộ');
      await apply();
      check(
        await evaluate(
          `location.search.includes('type=Apartment') && document.querySelector('#filter-type').textContent.includes('Căn hộ')`,
        ),
        'Type query and label',
      );
      await open('more');
      await choose('50–100m²');
      await input('project', 'fe100000-0000-4000-8000-000000000001');
      await input('availability', 'Available');
      await input('location', 'Quận 7');
      await apply();
      check(
        await evaluate(
          `['minArea','maxArea','project','availability','location'].every(k=>new URLSearchParams(location.search).has(k)) && document.querySelector('#filter-more').classList.contains('is-active')`,
        ),
        'More filters and active outline',
      );
      await input('q', 'Riverside');
      await evaluate(`document.querySelector('.search-keyword').requestSubmit()`);
      await wait(`location.search.includes('q=Riverside')`);
      check(true, 'Keyword query');
      await input('sort', 'priceAsc');
      await wait(`location.search.includes('sort=priceAsc')`);
      check(true, 'Sort query');
      await wait(`document.querySelector('.property-results').getAttribute('aria-busy')==='false'`);
      await screenshot(`filters-${width}.png`);
      await open('more');
      await screenshot(`more-${width}.png`);
      if (width === 380)
        check(
          await evaluate(
            `Math.abs(document.querySelector('#search-filter-panel').getBoundingClientRect().bottom-innerHeight)<2`,
          ),
          'Mobile bottom sheet',
        );
      check(
        await evaluate(
          `(()=>{const r=document.querySelector('#search-filter-panel footer').getBoundingClientRect();return r.bottom<=innerHeight && r.top>=0;})()`,
        ),
        'Apply footer visible',
      );
      await choose('Xóa bộ lọc');
      await wait(
        `location.search==='' && document.querySelector('.property-results').getAttribute('aria-busy')==='false'`,
      );
      check(
        await evaluate(`!document.querySelector('.search-filter-trigger.is-active')`),
        'Reset clears URL and chips',
      );
      await open('price');
      await evaluate(`document.querySelector('[aria-label="Giá tối thiểu"]').focus()`);
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'ArrowRight',
        code: 'ArrowRight',
        windowsVirtualKeyCode: 39,
      });
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'ArrowRight',
        code: 'ArrowRight',
        windowsVirtualKeyCode: 39,
      });
      check(
        await evaluate(`document.querySelector('[name="minPrice"]').value==='100000000'`),
        'Minimum thumb keyboard changes input',
      );
      await input('minPrice', '1000000000');
      await input('maxPrice', '4000000000');
      await apply();
      check(
        await evaluate(
          `new URLSearchParams(location.search).get('minPrice')==='1000000000' && new URLSearchParams(location.search).get('maxPrice')==='4000000000'`,
        ),
        'Custom numeric bounds apply',
      );
      await open('more');
      await evaluate(`document.querySelector('[aria-label="Diện tích tối đa"]').focus()`);
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'ArrowLeft',
        code: 'ArrowLeft',
        windowsVirtualKeyCode: 37,
      });
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'ArrowLeft',
        code: 'ArrowLeft',
        windowsVirtualKeyCode: 37,
      });
      check(
        await evaluate(`document.querySelector('[name="maxArea"]').value==='1999'`),
        'Maximum area thumb keyboard changes input',
      );
      await apply();
      check(await evaluate(`location.search.includes('maxArea=1999')`), 'Area slider applies query');
      await input('q', 'Quận 7');
      await evaluate(`document.querySelector('.search-keyword').requestSubmit()`);
      await wait(
        `new URLSearchParams(location.search).get('q')==='Quận 7' && document.querySelector('.property-results').getAttribute('aria-busy')==='false'`,
      );
      check(await evaluate(`!!document.querySelector('.discovery-card')`), 'Keyword matches locations');
      await open('price');
      await input('minPrice', '9');
      await input('maxPrice', '1');
      check(
        await evaluate(
          `Array.from(document.querySelectorAll('#search-filter-panel button')).find(b=>b.textContent==='Áp dụng').disabled`,
        ),
        'Reversed range blocked',
      );
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      });
      await wait(`!document.querySelector('#search-filter-panel')`);
      check(await evaluate(`document.documentElement.scrollWidth<=${width}`), `${width} still no overflow`);
    }
    console.log(`PASS: ${checks} search filter headless-Chrome UI checks at 1280px and 380px.`);
  } finally {
    ws?.close();
    if (chrome.exitCode === null) {
      const exited = once(chrome, 'exit');
      chrome.kill();
      await exited;
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
if (process.argv[1]?.endsWith('test-search-filters-ui.mjs')) {
  const test = spawn(
    process.execPath,
    [new URL('./test-discovery.mjs', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), '--ui'],
    { windowsHide: true, stdio: 'inherit' },
  );
  const [code] = await once(test, 'exit');
  process.exitCode = code;
}
