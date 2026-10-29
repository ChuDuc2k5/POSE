import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
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
const root = join(tmpdir(), 'pose-m06-cards');
await mkdir(root, { recursive: true });
let server,
  child,
  ws,
  send,
  checks = 0;
const check = (value, label) => {
  assert.ok(value, label);
  checks++;
};
try {
  let output = '';
  server = spawn(process.execPath, ['scripts/test-ai-agent.mjs', '--preview-only'], {
    cwd: new URL('..', import.meta.url),
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  server.stdout.on('data', (x) => (output += x));
  server.stderr.on('data', (x) => (output += x));
  for (let i = 0; i < 150 && !output.includes('PREVIEW READY:'); i++) {
    if (server.exitCode !== null) break;
    await delay(100);
  }
  assert.ok(output.includes('PREVIEW READY:'), output);
  child = spawn(
    chrome,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--disable-background-networking',
      '--no-proxy-server',
      '--remote-debugging-port=3305',
      `--user-data-dir=${join(root, 'chrome-' + Date.now())}`,
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  let target;
  for (let i = 0; i < 60; i++) {
    try {
      target = await (await fetch('http://127.0.0.1:3305/json/new?about:blank', { method: 'PUT' })).json();
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
        }, 10000);
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
  const wait = async (condition) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(condition)) return;
      await delay(50);
    }
    throw Error(
      'Timed out: ' +
        condition +
        '; ' +
        (await evaluate(
          "JSON.stringify({active:document.activeElement?.tagName,path:location.pathname,nextProperty:window.nextProperty,panel:!!document.querySelector('.ai-panel'),error:document.querySelector('.ai-error')?.textContent,text:document.body.innerText.slice(-1800)})",
        )),
    );
  };
  const click = (label) =>
    evaluate(
      `document.querySelector('[aria-label=${JSON.stringify(label === 'Mở trợ lý AI toàn màn hình' ? 'Mở toàn màn hình' : label.startsWith('Thu nh') ? 'Thu nhỏ' : label)}]').click()`,
    );
  const type = (text) =>
    evaluate(
      `(()=>{const e=document.querySelector('#ai-message');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  const key = async (shift = false) => {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      text: '\r',
      unmodifiedText: '\r',
      windowsVirtualKeyCode: 13,
      modifiers: shift ? 8 : 0,
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      modifiers: shift ? 8 : 0,
    });
  };
  const screenshot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(join(root, name + '.png'), Buffer.from(r.data, 'base64'));
  };
  await send('Page.enable');
  check(
    await evaluate('document.readyState==="loading" || document.readyState==="complete"'),
    'browser page is available for chat UI',
  );
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
 window.chatRequests=[];window.favoriteRequests=[];window.favoriteIds=[];window.failFavoritePut=false;window.recognitions=[];window.spoken=[];window.cancelCount=0;
 class Recognition{start(){window.recognitions.push(this);}stop(){this.onend?.();}abort(){this.onend?.();}emit(text,final=false){this.onresult?.({resultIndex:0,results:[{isFinal:final,0:{transcript:text}}]});if(final)this.onend?.();}}
 window.SpeechRecognition=Recognition;window.webkitSpeechRecognition=undefined;
 window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
 Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{lang:'vi-VN'}],cancel(){window.cancelCount++;},speak(u){window.spoken.push(u);}}});
 const originalFetch=window.fetch.bind(window);window.fetch=async(url,options)=>{
  if(url==='/api/ai/chat'){const body=JSON.parse(options.body);window.chatRequests.push(body);if(body.message.startsWith('BG_')){await window.__releasePromise;if(body.message==='BG_FAIL')throw new Error('background failure');}else await new Promise(r=>setTimeout(r,500));const result={session:{id:'f6300000-0000-4000-8000-000000000009'},reply:'Tôi là trợ lý AI của TERAVA. Q7-R01 giá thuê 25.000.000 VND/tháng, còn cho thuê.',criteria:{transaction_type:'Rent',location:'Quận 7',maxPrice:30000000},sources:[{id:'f6300000-0000-4000-8000-000000000003',code:'Q7-R01',name:'Căn hộ 2 phòng ngủ Quận 7',number:1,cover_id:null,area:80,bedrooms:2,location:'Quận 7',reason:'Gần chợ và trường học.',price:25000000,transaction_type:'Rent',price_period:'Month',availability:'Available',updated_at:'2026-10-15T00:00:00Z'}]};
 result.clarify={needed:false,question:null,options:[],refine:{question:'Bạn ưu tiên thêm tiêu chí nào?',options:['2 PN','Dưới 50 m²']}};
 window.chatSequence=(window.chatSequence||0)+(body.session_id?0:1);result.session.id=body.session_id||(window.chatSequence===1?'f6300000-0000-4000-8000-000000000009':'f6300000-0000-4000-8000-0000000001'+String(window.chatSequence).padStart(2,'0'));if(body.message==='FORMAT_TEST')result.reply='**đậm** *nghiêng*\\n- một\\n- hai\\n1. một\\n2. hai\\n[1] <img src=x onerror="window.__xss=1">';
 // Same SSE wire format as the backend (event name on its own line, no type in data): the widget always asks for text/event-stream.
 const sse=[['meta',{session_id:result.session.id,scope:'in_scope',sources:result.sources,related:[],criteria:result.criteria,clarify:result.clarify}],...result.reply.match(/.{1,48}/gs).map(text=>['delta',{text}]),['done',{message:result.reply,scope:'in_scope',blocked:false,guard:null,criteria:result.criteria,clarify:result.clarify}]].map(([event,data])=>'event: '+event+'\\ndata: '+JSON.stringify(data)+'\\n\\n').join('');
 return new Response(sse,{status:200,headers:{'Content-Type':'text/event-stream; charset=utf-8'}});}
  if(typeof url==='string'&&url.startsWith('/api/customer/favorites/status'))return new Response(JSON.stringify({ids:window.favoriteIds}),{status:200,headers:{'Content-Type':'application/json'}});
  if(typeof url==='string'&&url.startsWith('/api/customer/favorites/')){const method=options?.method||'GET';window.favoriteRequests.push({url,method});if(method==='PUT'&&window.failFavoritePut)throw new Error('favorite failure');const id=url.split('/').at(-1);if(method==='PUT'&&!window.favoriteIds.includes(id))window.favoriteIds.push(id);if(method==='DELETE')window.favoriteIds=window.favoriteIds.filter(value=>value!==id);return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}});}
  return originalFetch(url,options);};`,
  });
  for (const width of [1280, 380]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: width === 380,
    });
    await send('Page.navigate', { url: 'http://localhost:3300/properties' });
    await delay(500);
    await wait("document.readyState==='complete' && !!document.querySelector('.ai-launcher')");
    await delay(500);
    await click('Trò chuyện với trợ lý AI');
    await wait("document.activeElement?.id==='ai-message'");
    check(
      await evaluate(
        "document.querySelectorAll('.ai-suggestions button').length===3 && !document.querySelector('.ai-switch input').checked",
      ),
      width + ' welcome and explicit consent',
    );
    await screenshot('welcome-' + width);
    await evaluate("document.querySelector('.ai-suggestions button').click()");
    await wait("!!document.querySelector('.ai-typing')");
    check(await evaluate("document.querySelector('.ai-switch input').disabled"), 'consent locked during request');
    await wait("!!document.querySelector('.ai-property-card')");
    check(
      await evaluate(
        "!!document.querySelector('.ai-refine-question') && document.querySelectorAll('.ai-refine-options button').length===2 && !!document.querySelector('.ai-property-list + .ai-refine-question')",
      ),
      width + ' refining chips render below cards',
    );
    check(
      await evaluate(
        "!document.querySelector('.ai-source') && document.querySelector('.ai-property-card') && document.querySelector('.ai-switch input').disabled",
      ),
      'rental card, card evidence, consent lock',
    );
    check(
      await evaluate(
        "document.querySelectorAll('.ai-property-card').length===1 && document.querySelector('.ai-property-number').textContent==='[1]' && document.querySelector('.ai-property-placeholder') && document.querySelector('.ai-property-reason').textContent.includes('Gần chợ')",
      ),
      'card placeholder, badge and reason',
    );
    check(
      await evaluate(
        "document.querySelector('.ai-property-specs').textContent.includes('80') && document.querySelector('.ai-property-location').textContent.includes('Quận 7')",
      ),
      'card specs and live location',
    );
    check(
      await evaluate(
        "document.querySelector('.ai-property-actions a[href^=\"/sign-in?next=\"]')?.textContent.includes('Đăng nhập')",
      ),
      'guest card action requests sign-in with return path',
    );
    await wait("!document.querySelector('.ai-typing')");
    await evaluate(
      "[...document.querySelectorAll('.ai-refine-options button')].find(button=>button.textContent==='2 PN').click()",
    );
    await wait('chatRequests.length===2');
    await wait("!document.querySelector('.ai-typing')");
    check(await evaluate("chatRequests.at(-1).message==='2 PN'"), 'refining chip sends its text');
    await type('Dòng một');
    await evaluate("document.querySelector('#ai-message').focus()");
    await key(true);
    await wait("document.querySelector('#ai-message').value.includes('\\n')");
    check(await evaluate('chatRequests.length===2'), 'Shift Enter does not send');
    await key();
    await wait('chatRequests.length===3');
    await wait("!document.querySelector('.ai-typing')");
    check(
      await evaluate(
        "chatRequests.at(-1).criteria?.location==='Quận 7' && chatRequests.at(-1).criteria?.transaction_type==='Rent'",
      ),
      'second request sends criteria from the first reply',
    );
    await click('Nói thay vì gõ');
    await evaluate("recognitions.at(-1).emit('Tôi cần căn hộ',true)");
    await wait("document.querySelector('#ai-message').value==='Tôi cần căn hộ'");
    check(
      await evaluate("recognitions.at(-1).lang==='vi-VN' && chatRequests.length===3"),
      'dictation only edits textarea',
    );
    await click('Trò chuyện bằng giọng nói');
    await wait("document.querySelector('.ai-voice').dataset.state==='listening'");
    await evaluate("recognitions.at(-1).emit('Tìm căn hộ Quận 7',true)");
    await wait("document.querySelector('.ai-voice').dataset.state==='thinking'");
    await wait("document.querySelector('.ai-voice').dataset.state==='speaking'");
    check(await evaluate("spoken.at(-1).lang==='vi-VN' && spoken.at(-1).voice.lang==='vi-VN'"), 'Vietnamese synthesis');
    await evaluate("window.beforeEcho=cancelCount;recognitions.at(-1).emit('giá thuê 25.000.000 VND/tháng')");
    check(await evaluate('cancelCount===beforeEcho'), 'reply echo ignored');
    await evaluate("recognitions.at(-1).emit('Tôi muốn đổi khu vực')");
    check(await evaluate('cancelCount>beforeEcho'), 'interim barge-in cancels speech');
    await evaluate("recognitions.at(-1).emit('Tôi muốn đổi khu vực',true)");
    await wait('chatRequests.length===5');
    await wait("document.querySelector('.ai-voice').dataset.state==='speaking'");
    await screenshot('voice-' + width);
    await evaluate('spoken.at(-1).onend()');
    await wait("document.querySelector('.ai-voice').dataset.state==='listening'");
    await evaluate("document.querySelector('.ai-voice-end').click()");
    await wait("!!document.querySelector('#ai-message')");
    await evaluate('window.stoppedCount=recognitions.length;recognitions.at(-1).onend?.()');
    check(await evaluate('recognitions.length===stoppedCount'), 'ending voice prevents restart');
    await screenshot('reply-' + width);
    check(
      await evaluate(
        `(()=>{const p=document.querySelector('.ai-panel').getBoundingClientRect();return document.documentElement.scrollWidth<=${width} && p.left>=0 && p.right<=${width} && document.querySelector('.ai-panel').scrollWidth<=p.width+1;})()`,
      ),
      width + ' no overflow',
    );
    await evaluate('document.querySelector(\'[aria-label="Đóng"]\').focus()');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await wait("document.activeElement?.classList.contains('ai-launcher')");
    check(true, 'Escape restores launcher focus');
    await evaluate('sessionStorage.clear()');
  }

  await send('Page.navigate', { url: 'http://localhost:3300/properties' });
  await delay(500);
  await wait("!!document.querySelector('.ai-launcher')");
  await click('Trò chuyện với trợ lý AI');
  await evaluate("document.querySelector('.ai-switch input').click()");
  await type('Câu hỏi trước khi xem nhà');
  await click('Gửi');
  await wait("!!document.querySelector('.ai-property-card')");
  await type('Bản nháp đang viết');
  await wait("!!document.querySelector('.discovery-card')");
  await evaluate(
    "sessionStorage.setItem('test-original-messages',document.querySelector('.ai-log').innerText);sessionStorage.setItem('test-document-marker','123');window.card=document.querySelector('.discovery-card a[href^=\"/properties/\"]');sessionStorage.setItem('test-next-property',window.card.getAttribute('href').split('?')[0].split('/').at(-1));window.card.click()",
  );
  await wait(
    "location.pathname==='/properties/'+sessionStorage.getItem('test-next-property') && !!document.querySelector('.ai-panel') && document.querySelector('.ai-panel-head').innerText.includes('Đang xem:')",
  );
  check(
    await evaluate(
      "sessionStorage.getItem('test-document-marker')==='123' && document.querySelector('.ai-log').innerText===sessionStorage.getItem('test-original-messages') && document.querySelector('#ai-message').value==='Bản nháp đang viết' && document.querySelector('.ai-switch input').checked",
    ),
    'client navigation retains open panel, messages, consent and draft',
  );
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await screenshot('property-context-1280');
  await send('Emulation.setDeviceMetricsOverride', { width: 380, height: 900, deviceScaleFactor: 1, mobile: true });
  await screenshot('property-context-380');
  await type('Câu hỏi về căn đang xem');
  await click('Gửi');
  await wait('chatRequests.length>=1');
  await wait("!document.querySelector('.ai-typing')");
  check(
    await evaluate(
      "chatRequests.at(-1).session_id==='f6300000-0000-4000-8000-000000000009' && chatRequests.at(-1).property_id===sessionStorage.getItem('test-next-property') && chatRequests.at(-1).history.length===2 && chatRequests.at(-1).store_transcript",
    ),
    'next request retains session and history with current property',
  );
  await type('Bản nháp sau tải lại');
  await send('Page.reload');
  await delay(500);
  await wait("!!document.querySelector('.ai-panel') && document.querySelectorAll('.ai-row').length===4");
  check(
    await evaluate(
      "document.querySelector('#ai-message').value==='Bản nháp sau tải lại' && document.querySelector('.ai-switch input').checked",
    ),
    'reload restores conversation, consent, open panel and draft',
  );
  await click('Trò chuyện bằng giọng nói');
  await wait("document.querySelector('.ai-voice')?.dataset.state==='listening'");
  await evaluate(
    'window.activeMic=recognitions.at(-1);window.cancelBefore=cancelCount;document.querySelector(\'a[href="/properties"]\').click()',
  );
  await wait("location.pathname==='/properties' && !!document.querySelector('#ai-message')");
  check(
    await evaluate(
      "activeMic.onend===null && activeMic.onresult===null && activeMic.onerror===null && cancelCount>cancelBefore && document.querySelectorAll('.ai-row').length===4",
    ),
    'navigation stops recognition and speech without losing messages',
  );
  await type('Draft across filters');
  await evaluate(
    "(()=>{const e=document.querySelector('select[name=sort]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'priceAsc');e.dispatchEvent(new Event('change',{bubbles:true}));})()",
  );
  await wait(
    "location.search.includes('sort=priceAsc') && !!document.querySelector('.ai-panel') && document.querySelector('.property-results').getAttribute('aria-busy')==='false'",
  );
  check(
    await evaluate(
      "document.querySelectorAll('.ai-row').length===4 && document.querySelector('#ai-message').value==='Draft across filters'",
    ),
    'filter navigation and page remount retain messages and draft',
  );
  await click('Cuộc trò chuyện mới');
  await wait("document.querySelectorAll('.ai-row').length===0");
  check(
    await evaluate(
      "(()=>{const s=JSON.parse(sessionStorage.getItem('terava-chat-v1'));return s.messages.length===0 && !s.session_id && !s.store && s.draft==='';})()",
    ),
    'new conversation clears persisted session, messages, draft and consent',
  );
  await type('Riêng tư của khách');
  await click('Gửi');
  await wait("!!document.querySelector('.ai-property-card')");
  await send('Network.setCookie', { name: 'pose-access', value: 'fixture-User', url: 'http://localhost:3300' });
  await send('Page.reload');
  await delay(500);
  await wait("!!document.querySelector('.ai-launcher')");
  await click('Trò chuyện với trợ lý AI');
  check(
    await evaluate(
      "document.querySelectorAll('.ai-row').length===0 && JSON.parse(sessionStorage.getItem('terava-chat-v1')).ownerKey==='f6000000-0000-4000-8000-000000000001'",
    ),
    'signing in discards guest conversation',
  );
  await type('Riêng tư tài khoản thứ nhất');
  await click('Gửi');
  await wait("!!document.querySelector('.ai-property-card')");
  await wait("!!document.querySelector('.ai-favorite-control button')");
  await evaluate('window.favoriteChatBefore=chatRequests.length');
  await evaluate("document.querySelector('.ai-favorite-control button').click()");
  await wait("favoriteRequests.some(request=>request.method==='PUT')");
  check(
    await evaluate(
      "favoriteRequests.at(-1).url.endsWith('/f6300000-0000-4000-8000-000000000003') && chatRequests.length===window.favoriteChatBefore",
    ),
    'AI card favorite uses PUT without chat request',
  );
  check(
    await evaluate(
      "document.querySelector('.ai-favorite-control button[aria-pressed=\"true\"]')?.classList.contains('is-saved') === true",
    ),
    'AI card favorite is red, filled and pressed',
  );
  await evaluate('document.querySelector(\'.ai-property-actions button[aria-pressed="true"]\').click()');
  await wait("favoriteRequests.filter(request=>request.method==='DELETE').length===1");
  check(
    await evaluate('document.querySelector(\'.ai-property-actions button[aria-pressed="true"]\')===null'),
    'second AI card favorite click uses DELETE',
  );
  await evaluate("window.failFavoritePut=true;document.querySelector('.ai-favorite-control button').click()");
  await wait("!!document.querySelector('.favorite-error')");
  check(
    await evaluate('document.querySelector(\'.ai-favorite-control button[aria-pressed="true"]\')===null'),
    'failed AI card favorite PUT rolls back',
  );
  await evaluate('window.failFavoritePut=false');
  await evaluate(
    "Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Gặp chuyên viên').click()",
  );
  await evaluate('document.querySelector(\'a[href="/"]\').click()');
  await wait("location.pathname==='/' && !!document.querySelector('.ai-handoff')");
  check(
    await evaluate("document.querySelectorAll('.ai-row').length===2"),
    'customer home shares conversation and handoff state',
  );
  await evaluate('document.querySelector(\'a[href^="/properties/"]\').click()');
  await wait("location.pathname.startsWith('/properties/') && !!document.querySelector('.ai-handoff')");
  check(true, 'handoff form stays open on client navigation');
  await evaluate("document.querySelector('.account-trigger')?.click()");
  await delay(100);
  await evaluate("Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Đăng xuất').click()");
  await wait("location.pathname==='/sign-in'");
  check(
    await evaluate("!document.querySelector('.ai-chat') && !sessionStorage.getItem('terava-chat-v1')"),
    'sign out clears storage and hides assistant on auth page',
  );
  await send('Network.setCookie', { name: 'pose-access', value: 'fixture-Other', url: 'http://localhost:3300' });
  await send('Page.navigate', { url: 'http://localhost:3300/properties' });
  await delay(500);
  await wait("!!document.querySelector('.ai-launcher')");
  await click('Trò chuyện với trợ lý AI');
  check(
    await evaluate(
      "document.querySelectorAll('.ai-row').length===0 && JSON.parse(sessionStorage.getItem('terava-chat-v1')).ownerKey==='f6000000-0000-4000-8000-000000000002'",
    ),
    'another signed-in account cannot see previous conversation',
  );
  await type('Tài khoản thứ hai');
  await click('Gửi');
  await wait("!!document.querySelector('.ai-property-card')");
  await send('Network.setCookie', { name: 'pose-access', value: 'fixture-User', url: 'http://localhost:3300' });
  await send('Page.reload');
  await delay(500);
  await wait("!!document.querySelector('.ai-launcher')");
  await click('Trò chuyện với trợ lý AI');
  check(
    await evaluate("document.querySelectorAll('.ai-row').length===0"),
    'direct account change discards previous account conversation',
  );
  await evaluate("sessionStorage.setItem('terava-chat-v1','broken JSON')");
  await send('Page.reload');
  await delay(500);
  await wait("!!document.querySelector('.ai-launcher')");
  check(true, 'malformed storage safely discarded');
  await evaluate(
    "sessionStorage.setItem('terava-chat-v1',JSON.stringify({ownerKey:'f6000000-0000-4000-8000-000000000001',messages:Array.from({length:34},(_,i)=>({role:'user',content:'message '+i})),open:true,store:false,draft:''}))",
  );
  await send('Page.reload');
  await delay(500);
  await wait("document.querySelectorAll('.ai-row').length===30");
  check(
    await evaluate(
      "JSON.parse(sessionStorage.getItem('terava-chat-v1')).messages.length===30 && document.querySelector('.ai-bubble').textContent==='message 4'",
    ),
    'only the last 30 messages are restored and persisted',
  );
  await click('Đóng');
  await send('Page.reload');
  await delay(500);
  await wait("!!document.querySelector('.ai-launcher')");
  check(true, 'closed panel remains closed after reload');
  await send('Network.deleteCookies', { name: 'pose-access', url: 'http://localhost:3300' });
  await evaluate('sessionStorage.clear()');
  const blockedStorage = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "Object.defineProperty(window,'sessionStorage',{get(){throw new Error('Storage blocked');}})",
  });
  await send('Page.navigate', { url: 'http://localhost:3300/properties' });
  await delay(500);
  await wait("!!document.querySelector('.ai-launcher')");
  await click('Trò chuyện với trợ lý AI');
  await type('Storage unavailable');
  await click('Gửi');
  await wait("!!document.querySelector('.ai-property-card')");
  check(true, 'conversation works when storage reads and writes throw');
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blockedStorage.identifier });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;',
  });
  await send('Page.navigate', { url: 'http://localhost:3300/properties' });
  await delay(500);
  await wait("document.readyState==='complete' && !!document.querySelector('.ai-launcher')");
  await delay(500);
  await click('Trò chuyện với trợ lý AI');
  await delay(100);
  check(await evaluate('!document.querySelector(\'[aria-label="Nói thay vì gõ"]\')'), 'Firefox-like mic hidden');
  await click('Trò chuyện bằng giọng nói');
  await wait("!!document.querySelector('.ai-error')");
  check(
    await evaluate("document.querySelector('.ai-error').innerText.includes('Chrome hoặc Edge')"),
    'clear unsupported voice guidance',
  );
  await screenshot('no-speech-380');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  check(
    await evaluate("getComputedStyle(document.querySelector('.ai-send')).transitionDuration==='0s'"),
    'reduced motion',
  );
  await send('Network.setCookie', { name: 'pose-access', value: 'fixture-Admin', url: 'http://localhost:3300' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:3300/admin' });
  await delay(500);
  await wait("!!document.querySelector('.ai-usage-panel')");
  await screenshot('admin-usage-1280');
  // Full-page booking checks use the signed-in fixture so the appointment form is rendered.
  await send('Network.setCookie', { name: 'pose-access', value: 'fixture-User', url: 'http://localhost:3300' });
  // Full-page chat shares the widget state and stream implementation.
  await send('Page.navigate', { url: 'http://localhost:3300/properties' });
  await delay(500);
  await wait("!!document.querySelector('.ai-launcher')");
  await evaluate("document.querySelector('.ai-launcher').click()");
  await evaluate("document.querySelector('.ai-title').click()");
  await wait("location.pathname==='/tro-ly-ai' && !!document.querySelector('.ai-chat-full .ai-panel')");
  check(
    await evaluate(
      "document.querySelectorAll('.ai-row').length===0 && !!document.querySelector('.ai-full-suggestions button')",
    ),
    'header title opens empty full page',
  );
  await evaluate("document.querySelector('.ai-full-suggestions button').click()");
  await wait("document.querySelectorAll('.ai-row').length===2 && !!document.querySelector('.ai-property-card')");
  check(
    await evaluate("!!document.querySelector('.ai-property-card')"),
    'empty full page suggestion sends and renders a card',
  );
  await evaluate('document.querySelector(\'[aria-label^="Đặt lịch xem"]\').click()');
  await wait("!!document.querySelector('.ai-booking-form')");
  check(
    await evaluate(
      "document.querySelector('.ai-booking-row')?.previousElementSibling?.classList.contains('ai-row-assistant')",
    ),
    'booking form renders as an assistant row after the clicked answer',
  );
  check(
    await evaluate(
      "window.scrollY===0 && Math.abs(document.querySelector('.ai-panel-head').getBoundingClientRect().top-document.querySelector('.ai-panel').getBoundingClientRect().top)<1",
    ),
    'opening booking keeps the window at zero and header pinned to panel',
  );
  await wait("!!document.querySelector('.ai-booking-form input[type=radio]')");
  check(
    await evaluate(
      "(()=>{const radio=document.querySelector('.ai-booking-form input[type=radio]').getBoundingClientRect(),name=document.querySelector('.ai-booking-form fieldset label span').getBoundingClientRect();return Math.abs(radio.top-name.top)<24&&name.left>radio.right;})()",
    ),
    'radio and consultant name share a row',
  );
  check(
    await evaluate(
      "(()=>{const el=document.querySelector('.ai-booking-form fieldset label small'),bg=getComputedStyle(el.parentElement.parentElement).backgroundColor,fg=getComputedStyle(el).color;const p=s=>s.match(/[\\d.]+/g).map(Number).slice(0,3).map(v=>v/255),lum=s=>{const c=p(s).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]};return (Math.max(lum(fg),lum(bg))+.05)/(Math.min(lum(fg),lum(bg))+.05)>=4.5;})()",
    ),
    'consultant reason text meets contrast 4.5:1',
  );
  await screenshot('booking-form-1280');
  await send('Emulation.setDeviceMetricsOverride', { width: 380, height: 900, deviceScaleFactor: 1, mobile: true });
  await screenshot('booking-form-380');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate('document.querySelector(\'[title^="Thu"]\').click()');
  await wait("location.pathname==='/properties' && document.querySelectorAll('.ai-row').length===2");
  await evaluate('document.querySelector(\'a[href^="/properties/"]\').click()');
  await wait("location.pathname.startsWith('/properties/') && !!document.querySelector('.ai-panel')");
  const returnPropertyPath = await evaluate('window.returnPropertyPath=location.pathname+location.search');
  await evaluate("document.querySelector('.ai-title').click()");
  await wait("location.pathname==='/tro-ly-ai'");
  await type('Find a townhouse');
  await evaluate("document.querySelector('.ai-send').click()");
  await wait("document.querySelectorAll('.ai-row').length===4 && !document.querySelector('.ai-typing')");
  await evaluate('document.querySelector(\'[title^="Thu"]\').click()');
  await wait(
    "location.pathname+location.search===window.returnPropertyPath && document.querySelectorAll('.ai-row').length===4",
  );
  check(
    await evaluate(`window.returnPropertyPath===${JSON.stringify(returnPropertyPath)}`),
    'full page returns to the same property with both turns',
  );
  await send('Network.deleteCookies', { name: 'pose-access', url: 'http://localhost:3300' });
  await evaluate('sessionStorage.clear()');
  await send('Page.navigate', { url: 'http://localhost:3300/properties' });
  await delay(500);
  await wait("!!document.querySelector('.ai-launcher')");
  await evaluate("document.querySelector('.ai-launcher').click()");
  await type('Find an apartment in District 7');
  await evaluate("document.querySelector('.ai-send').click()");
  await wait("document.querySelectorAll('.ai-row').length===2 && !!document.querySelector('.ai-property-card')");
  await click('Mở trợ lý AI toàn màn hình');
  await wait("location.pathname==='/tro-ly-ai' && !!document.querySelector('.ai-chat-full .ai-panel')");
  check(
    await evaluate(
      "document.querySelectorAll('.ai-row').length===2 && !!document.querySelector('.ai-property-card') && document.querySelector('.ai-launcher')===null",
    ),
    'full page preserves conversation and hides launcher',
  );
  await send('Emulation.setDeviceMetricsOverride', { width: 380, height: 800, deviceScaleFactor: 1, mobile: true });
  check(
    await evaluate(
      "(()=>{const header=document.querySelector('.site-header').getBoundingClientRect(),panel=document.querySelector('.ai-panel').getBoundingClientRect(),composer=document.querySelector('.ai-composer')?.getBoundingClientRect()||document.querySelector('#ai-message').getBoundingClientRect(),log=document.querySelector('.ai-log');return panel.top<=header.bottom+24&&panel.bottom<=innerHeight+0.5&&composer.top>=0&&composer.bottom<=innerHeight+0.5&&document.documentElement.scrollHeight<=innerHeight+2&&log.scrollHeight>log.clientHeight;})()",
    ),
    'full page fits 380x800 and message log scrolls',
  );
  await screenshot('bigchat-380');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await screenshot('bigchat-1280');
  await type('Find a townhouse');
  await evaluate("document.querySelector('.ai-send').click()");
  await wait("document.querySelectorAll('.ai-row').length===4 && !document.querySelector('.ai-typing')");
  check(
    await evaluate(
      "(()=>{const header=document.querySelector('.site-header').getBoundingClientRect(),panel=document.querySelector('.ai-panel').getBoundingClientRect(),composer=document.querySelector('.ai-composer')?.getBoundingClientRect()||document.querySelector('#ai-message').getBoundingClientRect(),log=document.querySelector('.ai-log');return panel.top<=header.bottom+24&&panel.bottom<=innerHeight+0.5&&composer.top>=0&&composer.bottom<=innerHeight+0.5&&document.documentElement.scrollHeight<=innerHeight+2&&log.scrollHeight>log.clientHeight;})()",
    ),
    'full page fits 1280x800 and message log scrolls',
  );
  await click('Thu nhỏ trợ lý AI');
  await wait("location.pathname==='/properties' && document.querySelectorAll('.ai-row').length===4");
  check(await evaluate('document.documentElement.scrollWidth<=1280'), 'full page returns to widget without overflow');
  // Full-page acceptance coverage: history, privacy masking, rich replies, citations and latest-message affordance.
  await evaluate('(()=>{localStorage.clear();sessionStorage.clear();return true})()');
  await send('Page.navigate', { url: 'http://localhost:3300/properties?reset=' + Date.now() });
  await delay(600);
  await wait("!!document.querySelector('.ai-launcher')");
  await evaluate("(()=>{localStorage.clear();sessionStorage.clear();location.href='/properties';return true})()");
  await delay(600);
  await wait("!!document.querySelector('.ai-launcher')");
  await evaluate("document.querySelector('.ai-launcher').click()");
  await wait("!!document.querySelector('.ai-title')");
  await evaluate("document.querySelector('.ai-title').click()");
  await wait("location.pathname==='/tro-ly-ai' && !!document.querySelector('.ai-history')");
  check(
    await evaluate(
      "(()=>{const h=document.querySelector('.ai-history'),p=document.querySelector('.ai-panel');return getComputedStyle(h).display!=='none'&&getComputedStyle(h).backgroundColor!==getComputedStyle(p).backgroundColor;})()",
    ),
    '1280 history sidebar and distinct chat surface',
  );
  check(
    await evaluate(
      "(()=>{const s=document.querySelector('.ai-history-summary').getBoundingClientRect(),l=document.querySelector('.ai-log').getBoundingClientRect();return s.right<=l.left||s.bottom<=l.top||s.left>=l.right||s.top>=l.bottom;})()",
    ),
    'history summary stays out of the chat log',
  );
  await evaluate(
    "localStorage.setItem('terava-chat-history-v1',JSON.stringify([{id:'f7400000-0000-4000-8000-000000000002',title:'Second private conversation',time:new Date().toISOString(),messages:[{role:'user',content:'Second private conversation'}]},{id:'f7400000-0000-4000-8000-000000000001',title:'0901234567 a@b.vn',time:new Date().toISOString(),messages:[{role:'user',content:'0901234567 a@b.vn'},{role:'assistant',content:'**đậm** *nghiêng*\\n- một\\n1. một\\n[1] <img src=x onerror=\\\"window.__xss=1\\\">'}]}]))",
  );
  await send('Page.navigate', { url: 'http://localhost:3300/tro-ly-ai?history=' + Date.now() });
  await delay(500);
  await wait("document.querySelectorAll('.ai-history-item').length===2");
  await evaluate(
    "(()=>{const h=JSON.parse(localStorage.getItem('terava-chat-history-v1'));h[1].messages[1].sources=[{id:'f6300000-0000-4000-8000-000000000003',code:'Q7-R01',name:'Căn hộ 2 phòng ngủ Quận 7',number:1,cover_id:null,area:80,bedrooms:2,location:'Quận 7',reason:'Gần chợ và trường học.',price:25000000,transaction_type:'Rent',price_period:'Month',availability:'Available',updated_at:'2026-10-15T00:00:00Z'}];localStorage.setItem('terava-chat-history-v1',JSON.stringify(h));return true})()",
  );
  await send('Page.navigate', { url: 'http://localhost:3300/tro-ly-ai?history-sources=' + Date.now() });
  await delay(500);
  await wait("document.querySelectorAll('.ai-history-item').length===2");
  check(
    await evaluate(
      "(()=>{const titles=[...document.querySelectorAll('.ai-history-item strong')].map(e=>e.textContent);return titles.length===2&&titles.every(t=>!/[0-9]{7,}|@/.test(t));})()",
    ),
    'history lists two masked conversations without PII',
  );
  check(
    await evaluate(
      "document.body.innerText.includes('Tối đa 20 cuộc') && !document.body.innerText.includes(String.fromCharCode(37)+'E1')",
    ),
    'history retention text is decoded and has no URL-encoded text',
  );
  await evaluate("document.querySelectorAll('.ai-history-item>button:first-child')[1].click()");
  await wait("document.querySelector('.ai-bubble')?.textContent.includes('0901234567')");
  check(true, 'clicking the first conversation restores its messages');
  await wait("!!document.querySelector('.ai-answer strong') && !!document.querySelector('.ai-answer em')");
  check(
    await evaluate(
      "(()=>{const a=document.querySelector('.ai-answer');return !!a.querySelector('strong')&&!!a.querySelector('em')&&!!a.querySelector('ul li')&&!!a.querySelector('ol li')&&!a.innerText.includes('**')&&!window.__xss&&!a.querySelector('img');})()",
    ),
    'safe markdown lists and XSS-safe reply rendering',
  );
  check(
    await evaluate("document.querySelectorAll('.ai-citation-chip').length>=1"),
    'final cited source is rendered as a citation chip',
  );
  await evaluate("document.querySelector('.ai-citation-chip').click()");
  check(await evaluate("!!document.querySelector('.is-citation-target')"), 'citation chip highlights card one');
  await evaluate(
    "(()=>{const item=document.querySelectorAll('.ai-history-item')[1];item.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:120,clientY:120}));return true})()",
  );
  await wait("document.querySelector('[role=menu]')?.innerText.includes('Ghim cuộc trò chuyện')");
  check(
    await evaluate("document.querySelector('[role=menu]')?.innerText.includes('Xoá cuộc trò chuyện')"),
    'context menu shows pin and delete',
  );
  await evaluate("document.querySelector('[role=menuitem]').click()");
  await wait("document.querySelector('.ai-history-group h3')?.textContent.includes('Đã ghim')");
  await send('Page.reload');
  await delay(500);
  await wait("document.querySelector('.ai-history-group h3')?.textContent.includes('Đã ghim')");
  check(true, 'pin survives reload');
  await evaluate(
    "(()=>{const item=document.querySelector('.ai-history-group .ai-history-item');item.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:120,clientY:120}));return true})()",
  );
  await evaluate("document.querySelector('[role=menuitem]').click()");
  await wait("!document.querySelector('.ai-history-group h3')?.textContent.includes('Đã ghim')");
  check(true, 'unpin restores the normal history groups');
  await evaluate("document.querySelector('.ai-history-options').click()");
  await wait("!!document.querySelector('[role=menu]')");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait("!document.querySelector('[role=menu]')");
  check(true, 'Escape closes the history menu');
  await evaluate(
    "(()=>{const item=document.querySelectorAll('.ai-history-item')[1];item.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:120,clientY:120}));return true})()",
  );
  await evaluate("document.querySelectorAll('[role=menuitem]')[1].click()");
  await wait("!!document.querySelector('[role=dialog]')");
  await evaluate(
    "[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent==='Huỷ').click()",
  );
  check(await evaluate("document.querySelectorAll('.ai-history-item').length===2"), 'cancel keeps the item');
  await evaluate(
    "(()=>{const item=document.querySelectorAll('.ai-history-item')[1];item.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:120,clientY:120}));return true})()",
  );
  await evaluate("document.querySelectorAll('[role=menuitem]')[1].click()");
  await wait("!!document.querySelector('[role=dialog]')");
  await evaluate(
    "[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent==='Xoá').click()",
  );
  await wait("document.querySelectorAll('.ai-history-item').length===1");
  check(true, 'local history delete removes an item');
  check(
    await evaluate("document.querySelectorAll('.ai-history-item').length===1"),
    'deleted local conversation is absent from history',
  );
  await wait("!!document.querySelector('.ai-history')");
  check(
    await evaluate("getComputedStyle(document.querySelector('.ai-log')).scrollbarWidth==='thin'"),
    'message log has a thin scrollbar',
  );
  await evaluate(
    "(()=>{const e=document.querySelector('.ai-log');e.style.height='200px';e.style.flex='none';e.style.overflowY='auto';e.style.scrollBehavior='auto';e.scrollTop=Math.max(0,(e.scrollHeight-e.clientHeight)/2);e.dispatchEvent(new Event('scroll',{bubbles:true}));return true})()",
  );
  await delay(100);
  await type('FORMAT_TEST');
  await evaluate("document.querySelector('.ai-send').click()");
  await wait("!!document.querySelector('.ai-latest')");
  await evaluate("document.querySelector('.ai-latest').click()");
  check(
    await evaluate(
      "(()=>{const e=document.querySelector('.ai-log');return e.scrollTop+e.clientHeight>=e.scrollHeight-24;})()",
    ),
    'latest-message button returns to bottom',
  );
  await send('Emulation.setDeviceMetricsOverride', { width: 380, height: 900, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'http://localhost:3300/tro-ly-ai?mobile=' + Date.now() });
  await delay(500);
  await wait("!!document.querySelector('.ai-history-mobile')");
  await evaluate("document.querySelector('.ai-history-mobile').click()");
  check(
    await evaluate("document.querySelector('.ai-history.is-open')&&document.documentElement.scrollWidth<=380"),
    'mobile history drawer opens without horizontal overflow',
  );
  await evaluate("document.querySelector('.ai-history-item>button:first-child').click()");
  await wait("!document.querySelector('.ai-history.is-open')");
  check(true, 'mobile history drawer closes after restore');
  // Concurrent conversations: delayed responses stay attached to their own history item.
  await evaluate(
    '(()=>{localStorage.clear();sessionStorage.clear();window.__releasePromise=new Promise(r=>window.__release=r);return true})()',
  );
  await send('Page.navigate', { url: 'http://localhost:3300/properties?concurrency=' + Date.now() });
  await delay(600);
  await wait("!!document.querySelector('.ai-launcher')");
  await click('Trò chuyện với trợ lý AI');
  await wait("!!document.querySelector('.ai-panel')");
  await evaluate("document.querySelector('.ai-title').click()");
  await wait("location.pathname==='/tro-ly-ai'");
  await evaluate('(()=>{window.__releasePromise=new Promise(r=>window.__release=r);return true})()');
  await type('BG_ONE');
  await evaluate("document.querySelector('.ai-send').click()");
  await wait("!!document.querySelector('.ai-typing')");
  await evaluate("document.querySelector('.ai-panel-head .ai-icon').click()");
  await type('BG_TWO');
  await evaluate("document.querySelector('.ai-send').click()");
  await wait("!!document.querySelector('.ai-typing')");
  check(
    await evaluate("!document.body.innerText.includes('Đã dừng')"),
    'switching conversations does not stop a background stream',
  );
  await evaluate('window.__release()');
  await wait("!document.querySelector('.ai-typing')");
  check(
    await evaluate(
      "document.body.innerText.includes('Tôi là trợ lý AI') && document.querySelectorAll('.ai-property-card').length>0",
    ),
    'completed background reply and card return with its conversation',
  );
  check(
    await evaluate("document.body.innerText.includes('Trợ lý AI')"),
    'conversation remains available after background completion',
  );
  await evaluate('(()=>{window.__releasePromise=new Promise(r=>window.__release=r);return true})()');
  await type('BG_THREE');
  await evaluate("document.querySelector('.ai-send').click()");
  await wait("!!document.querySelector('.ai-typing')");
  check(
    await evaluate("document.querySelector('.ai-typing')!==null"),
    'concurrent send remains in flight and is subject to the two-request limit',
  );
  await evaluate('window.__release()');
  await wait("!document.querySelector('.ai-typing')");
  await evaluate('(()=>{window.__releasePromise=new Promise(r=>window.__release=r);return true})()');
  await type('BG_STOP');
  await evaluate("document.querySelector('.ai-send').click()");
  await wait("!!document.querySelector('.ai-stop')");
  await evaluate("document.querySelector('.ai-stop').click()");
  check(
    await evaluate("document.body.innerText.includes('Đã dừng')"),
    'Stop writes a stopped reply for the visible conversation',
  );
  await evaluate('window.__release()');
  await wait("!document.querySelector('.ai-typing')");
  await evaluate('(()=>{window.__releasePromise=new Promise(r=>window.__release=r);return true})()');
  await type('BG_FAIL');
  await evaluate("document.querySelector('.ai-send').click()");
  await wait("!!document.querySelector('.ai-typing')");
  await evaluate('window.__release()');
  await wait("document.querySelector('.ai-error')?.textContent.includes('background failure')");
  check(true, 'request errors are shown in the owning conversation');
  // Regression: a completed exchange must survive navigation/auth restoration with its answer and cards.
  await evaluate('(()=>{localStorage.clear();sessionStorage.clear();return true})()');
  await send('Page.navigate', { url: 'http://localhost:3300/properties?history-regression=' + Date.now() });
  await delay(500);
  await wait("!!document.querySelector('.ai-launcher')");
  await click('Trò chuyện với trợ lý AI');
  await wait("!!document.querySelector('.ai-panel')");
  await type('Find an apartment in District 7');
  await evaluate("document.querySelector('.ai-send').click()");
  await wait("document.querySelectorAll('.ai-row').length===2 && !!document.querySelector('.ai-property-card')");
  await delay(250);
  check(
    await evaluate(
      "JSON.parse(localStorage.getItem('terava-chat-history-v1')||'[]').some(item=>item.messages?.length>=2&&item.messages.some(message=>message.role==='assistant'&&message.content))",
    ),
    'completed exchange stores assistant answer and cards',
  );
  await evaluate("document.querySelector('.ai-title').click()");
  await wait("location.pathname==='/tro-ly-ai'");
  await evaluate("document.querySelector('.ai-history-item button').click()");
  await wait("document.querySelectorAll('.ai-row').length===2");
  check(
    await evaluate("!!document.querySelector('.ai-answer')&&!!document.querySelector('.ai-property-card')"),
    'history reopen restores answer and cards',
  );
  // Hotfix 4 regression: signed-in conversations with transcript saving off are restored from local history.
  await send('Network.setCookie', { name: 'pose-access', value: 'fixture-User', url: 'http://localhost:3300' });
  await evaluate('(()=>{localStorage.clear();sessionStorage.clear();return true})()');
  await send('Page.navigate', { url: 'http://localhost:3300/properties?hotfix4=' + Date.now() });
  await delay(500);
  await wait("!!document.querySelector('.ai-launcher')");
  await click('Trò chuyện với trợ lý AI');
  await wait("!!document.querySelector('.ai-panel')");
  check(await evaluate("!document.querySelector('.ai-switch input').checked"), 'signed-in transcript saving is off');
  await type('Find an apartment in District 7');
  await evaluate("document.querySelector('.ai-send').click()");
  await wait("document.querySelectorAll('.ai-row').length===2 && !!document.querySelector('.ai-property-card')");
  await evaluate('document.querySelectorAll(\'[aria-label="Cuộc trò chuyện mới"]\')[0].click()');
  await type('Find a townhouse');
  await evaluate("document.querySelector('.ai-send').click()");
  await wait("document.querySelectorAll('.ai-row').length===2 && !!document.querySelector('.ai-property-card')");
  await send('Page.reload');
  await delay(500);
  await wait("(()=>{document.querySelector('.ai-launcher')?.click();return !!document.querySelector('.ai-panel')})()");
  await evaluate("document.querySelector('.ai-title').click()");
  await wait("location.pathname==='/tro-ly-ai' && document.querySelectorAll('.ai-history-item').length>=2");
  check(
    await evaluate("document.querySelectorAll('.ai-history-item').length>=2"),
    'two local conversations remain in history after reload',
  );
  await evaluate("document.querySelectorAll('.ai-history-item button:first-child')[0].click()");
  await wait("document.querySelectorAll('.ai-property-card').length>0");
  check(
    await evaluate("!!document.querySelector('.ai-answer')&&document.querySelectorAll('.ai-property-card').length>0"),
    'first saved answer and cards reopen',
  );
  await evaluate("document.querySelectorAll('.ai-history-item button:first-child')[1].click()");
  await wait("document.querySelectorAll('.ai-property-card').length>0");
  check(
    await evaluate("!!document.querySelector('.ai-answer')&&document.querySelectorAll('.ai-property-card').length>0"),
    'second saved answer and cards reopen',
  );
  console.log(
    `PASS: ${checks} M06 chat UI checks at 1280px and 380px; full-page chat, dictation, voice, barge-in, fallback, keyboard and consent.`,
  );
  console.log(`Screenshots: ${root}`);
} finally {
  if (send && ws?.readyState === WebSocket.OPEN) {
    try {
      await send('Browser.close');
    } catch {}
  }
  ws?.close();
  try {
    await stopProcess(child, { tree: true });
  } finally {
    await stopProcess(server, { graceful: true });
  }
}
