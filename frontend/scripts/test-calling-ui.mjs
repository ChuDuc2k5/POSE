// From frontend/: set PGLITE_PATH to an external @electric-sql/pglite directory;
// npx next build; node scripts/test-calling-ui.mjs. Starts/stops its own fixtures.
// CHROME_PATH is optional; otherwise Chrome is detected in Windows install paths.
// PowerShell: $env:PGLITE_PATH='C:/Users/Admin/AppData/Local/Temp/pose-m06-pg/node_modules/@electric-sql/pglite'
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { stopProcess } from './campaign-test-process.mjs';

let chrome;
for(const candidate of [process.env.CHROME_PATH,process.env.PROGRAMFILES && join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'],'Google/Chrome/Application/chrome.exe'),process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA,'Google/Chrome/Application/chrome.exe')].filter(Boolean)){try{await access(candidate);chrome=candidate;break;}catch{}}
if(!chrome){console.log('SKIP: M08 UI checks; Chrome not found. Set CHROME_PATH to a Chrome executable.');process.exit(0);}
assert.ok(process.env.PGLITE_PATH,'Set PGLITE_PATH to an external @electric-sql/pglite directory.');
const root=join(tmpdir(),'pose-m08-ui');await mkdir(root,{recursive:true});
let child,server,ws,send,checks=0;
try {
 let output='';server=spawn(process.execPath,['scripts/test-automated-calling.mjs','--preview-only'],{cwd:new URL('..',import.meta.url),env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 server.stdout.on('data',x=>output+=x);server.stderr.on('data',x=>output+=x);
 for(let i=0;i<120 && !output.includes('PREVIEW READY:');i++){if(server.exitCode!==null)break;await delay(100);}
 assert.ok(output.includes('PREVIEW READY:'),'isolated preview ready: '+output);
 child=spawn(chrome,['--headless','--disable-gpu','--no-first-run','--disable-background-networking','--remote-debugging-port=3502',`--user-data-dir=${join(root,'isolated-'+Date.now())}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let target;
 for(let i=0;i<40;i++){try{target=await (await fetch('http://127.0.0.1:3502/json/new?about:blank',{method:'PUT'})).json();if(target.webSocketDebuggerUrl)break;}catch{}await delay(250);}
 assert.ok(target?.webSocketDebuggerUrl,'Chrome test target ready');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 let next=0;const pending=new Map();ws.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.id && pending.has(m.id)){const {resolve,reject}=pending.get(m.id);pending.delete(m.id);if(m.error)reject(Error(JSON.stringify(m.error)));else resolve(m.result);}});
 send=(method,params={})=>new Promise((resolve,reject)=>{const n=++next;const timer=setTimeout(()=>{pending.delete(n);reject(Error('Chrome command timeout: '+method));},10000);pending.set(n,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true})).result.value;
 await send('Page.enable');
 const waitFor=async(expression,label)=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await delay(100);}throw Error(label+'; '+await evaluate('document.body.innerText'));};
 const screenshots=[];
 async function shot(name,full=true){const {cssContentSize}=await send('Page.getLayoutMetrics');const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:full,...(full?{clip:{x:0,y:0,width:cssContentSize.width,height:cssContentSize.height,scale:1}}:{})});const file=join(root,name+'.png');await writeFile(file,Buffer.from(image.data,'base64'));assert.ok((await stat(file)).size>10000,name+' screenshot');screenshots.push(file);}
 const press=async(key,extra={})=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,...extra});await send('Input.dispatchKeyEvent',{type:'keyUp',key,...extra});};
 const visible=async selector=>assert.ok(await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r&&r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0;})()`),selector+' visible');
 const textInput=async text=>evaluate(`(()=>{const field=document.querySelector('.calls-playground textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,${JSON.stringify(text)});field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const adminCalls=(await (await fetch('http://localhost:3500/api/calls',{headers:{Cookie:'pose-access=fixture-admin'}})).json()).items;
 const assigned=(await (await fetch('http://localhost:3500/api/calls',{headers:{Cookie:'pose-access=fixture-sales'}})).json()).items;
 assert.equal(adminCalls.length,5);assert.equal(assigned.length,4);assert.ok(adminCalls.some(c=>!assigned.some(a=>a.id===c.id)),'unassigned call excluded by RLS');
 const completed=adminCalls.find(c=>c.cost_actual!==null),live=adminCalls.find(c=>c.status==='CALLING');assert.ok(completed&&live);
 for(const width of [1280,380])for(const page of ['list','detail','playground','sales']){
  const name=page+'-'+width;
  await send('Emulation.setDeviceMetricsOverride',{width,height:1100,screenWidth:width,screenHeight:1100,deviceScaleFactor:1,mobile:width===380});
  const path=page==='sales'?'/sales':page==='detail'?'/admin/calls/'+completed.id:page==='playground'?'/admin/calls/playground':'/admin/calls';
  await send('Page.navigate',{url:'http://localhost:3501/fixture?role='+(page==='sales'?'sales':'admin')+'&path='+encodeURIComponent(path)});
  const condition=page==='sales'?"document.querySelectorAll('.calls-sales .calls-item').length===4":page==='list'?"document.querySelectorAll('.calls-item').length===5&&document.querySelectorAll('.calls-filters select').length===3":page==='detail'?"document.querySelectorAll('.calls-timeline li').length>=3&&!!document.querySelector('[data-call-cost]')":"document.querySelector('.catalog-sidebar')&&document.querySelector('select option[value=\"f7800000-0000-4000-8000-000000000001\"]')";
  await waitFor(`document.readyState==='complete'&&!!(${condition})`,name+' specific content');
  if(page!=='sales'){
   const shell=await evaluate("({nav:Array.from(document.querySelectorAll('.catalog-sidebar nav a')).map(a=>a.innerText),active:document.querySelector('.catalog-sidebar nav [aria-current]')?.innerText,label:document.querySelector('.catalog-sidebar-label')?.innerText,note:!!document.querySelector('.catalog-sidebar-note'),profile:!!document.querySelector('.catalog-sidebar-bottom a'),logout:!!document.querySelector('.catalog-sidebar-bottom button'),breadcrumb:document.querySelector('.catalog-topbar')?.innerText})");
   assert.deepEqual(shell.nav,['Danh mục bất động sản','Chiến dịch gọi','Cuộc gọi']);assert.equal(shell.active,'Cuộc gọi');assert.equal(shell.label,'KHÔNG GIAN QUẢN TRỊ');assert.ok(shell.note&&shell.profile&&shell.logout);assert.ok(shell.breadcrumb.includes('Quản trị')&&shell.breadcrumb.includes('Cuộc gọi'));await visible('.catalog-sidebar nav');
  }
  if(page==='list'){
   await visible('.calls-filters');await visible('.calls-item');const content=await evaluate("document.querySelector('.calls-list').innerText");for(const label of ['Giả lập','Chiến dịch','Bắt đầu','Thời lượng','Lý do kết thúc','Xem chi tiết'])assert.ok(content.includes(label),name+' '+label);for(const call of adminCalls)assert.ok(!content.includes(call.phone_e164),'masked list phone');assert.equal(await evaluate("!!document.querySelector('dialog[open]')"),false,'clean list screenshot');
  }
  if(page==='detail'){
   await visible('[data-call-cost]');const cost=await evaluate("document.querySelector('[data-call-cost]').innerText");for(const label of ['3.500.000 VND','0,01 USD','25.000','Tỷ giá giả lập'])assert.ok(cost.includes(label),name+' '+label);
   assert.ok(await evaluate("Array.from(document.querySelectorAll('.calls-timeline li')).every(li=>li.querySelector('time')&&li.querySelector('strong')&&li.innerText.includes('Nguồn: Giả lập'))"),'timeline time type source');
   assert.ok(await evaluate(`document.querySelector('.calls-detail-heading').innerText.includes(${JSON.stringify(completed.phone_e164)})`),'Admin detail full phone');
   assert.ok(await evaluate("Array.from(document.querySelectorAll('.calls-detail .calls-actions button')).find(b=>b.innerText==='Không liên hệ').classList.contains('secondary')"),'secondary opt-out');
  }
  if(page==='sales'){
   await visible('.calls-sales .catalog-title');await visible('.calls-sales .calls-item');await waitFor("!!document.querySelector('.ai-workspace article')",'M06 hand-off item');
   const text=await evaluate('document.body.innerText');for(const label of ['Cuộc gọi của khách được giao','Minh Anh','Bàn giao từ trợ lý AI','Chưa đồng ý lưu','Đang xử lý','Lưu thất bại'])assert.ok(text.includes(label),name+' '+label);
   const ids=await evaluate("Array.from(document.querySelectorAll('.calls-sales .calls-item')).map(el=>el.dataset.callId)");assert.deepEqual(ids.sort(),assigned.map(c=>c.id).sort(),'Sales rows match RLS');assert.equal(await evaluate("!!document.querySelector('.account-card')"),false,'no generic welcome card');
   assert.ok(await evaluate("!!document.querySelector('.calls-evidence-links a[href$=\"#recording\"]')&&!!document.querySelector('.calls-evidence-links a[href$=\"#transcript\"]')"),'Sales evidence links');
  }
  if(page==='playground'){
   await visible('.calls-playground h1');const buttons=await evaluate("Array.from(document.querySelectorAll('.calls-playground .button.secondary')).map(b=>({label:b.innerText,disabled:b.disabled,opacity:getComputedStyle(b).opacity}))");assert.deepEqual(buttons.map(b=>b.label),['Im lặng','Ngắt lời','Bắt đầu lại']);assert.ok(buttons[0].disabled&&buttons[1].disabled&&Number(buttons[0].opacity)<Number(buttons[2].opacity),'visible disabled state');
   assert.ok(await evaluate("document.querySelector('.calls-playground').innerText.includes('Mô phỏng — không có cuộc gọi thật')"),'simulation banner');
   await evaluate("(()=>{const select=document.querySelector('.calls-playground select');select.value='f7800000-0000-4000-8000-000000000001';select.dispatchEvent(new Event('change',{bubbles:true}));})()");await evaluate("document.querySelector('.calls-playground form').requestSubmit()");await waitFor("document.querySelectorAll('.calls-bubble-ai').length===1",'opening bubble');
   for(let n=1;n<=3;n++){await textInput('đồng ý');await evaluate("document.querySelector('.calls-playground form').requestSubmit()");await waitFor(`document.querySelectorAll('.calls-bubble-customer').length===${n}&&document.querySelectorAll('.calls-bubble-ai').length===${n+1}`,'consent bubble '+n);}
   assert.ok(await evaluate("getComputedStyle(document.querySelector('.calls-bubble-ai')).backgroundColor!==getComputedStyle(document.querySelector('.calls-bubble-customer')).backgroundColor"),'distinct bubbles');
   await textInput('Tôi cần tư vấn căn hộ.');await evaluate("document.querySelector('.calls-playground form').requestSubmit()");await waitFor("!!document.querySelector('.calls-pending')",'pending reply');assert.equal(await evaluate("document.querySelector('.calls-pending').innerText"),'Trợ lý đang soạn câu trả lời…');await waitFor("!document.querySelector('.calls-pending')&&document.querySelectorAll('.calls-bubble-customer').length===4",'model replied');
  }
  const dimensions=await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})');assert.equal(dimensions.width,width);assert.ok(dimensions.scroll<=width,name+' no overflow '+JSON.stringify(dimensions));await shot(name);checks++;
  if(page==='list'){
   await evaluate(`(()=>{const b=document.querySelector('[data-call-id="${live.id}"] .calls-actions button');b.focus();b.click();})()`);await waitFor("!!document.querySelector('dialog[open] textarea[required]')",'stop reason modal');assert.ok(await evaluate("document.querySelector('dialog').contains(document.activeElement)"),'modal focus');
   await evaluate("document.querySelector('dialog .button.primary').focus()");await press('Tab',{code:'Tab',windowsVirtualKeyCode:9});assert.ok(await evaluate("document.querySelector('dialog').contains(document.activeElement)"),'focus trapped');assert.equal(await evaluate("document.querySelectorAll('.calls-item').length"),5,'list stays rendered');
   const backdrop=await evaluate("getComputedStyle(document.querySelector('dialog'),'::backdrop').backgroundColor");assert.ok(backdrop.includes('0.65')||backdrop.includes('/ 0.65'),'translucent '+backdrop);await shot('list-modal-'+width,false);await press('Escape',{code:'Escape',windowsVirtualKeyCode:27});await waitFor("!document.querySelector('dialog[open]')",'Esc closes modal');assert.equal(await evaluate('document.activeElement.innerText'),'Dừng cuộc gọi','restored focus');
  }
  if(page==='detail'){await evaluate("Array.from(document.querySelectorAll('.calls-detail .calls-actions button')).find(b=>b.innerText==='Không liên hệ').click()");await waitFor("document.querySelector('dialog[open]')?.innerText.includes('Ghi nhận không liên hệ')",'opt-out reason dialog');await press('Escape',{code:'Escape',windowsVirtualKeyCode:27});}
 }
 // Check the catalog's expanded, collapsed and mobile navigation using the real page.
 for (const width of [1280,840,380]) {
  await send('Emulation.setDeviceMetricsOverride',{width,height:1100,screenWidth:width,screenHeight:1100,deviceScaleFactor:1,mobile:width===380});
  await send('Page.navigate',{url:'http://localhost:3501/fixture?role=admin&path=/admin'});
  await waitFor("!!document.querySelector('.catalog-workspace .catalog-sidebar')",'catalog sidebar '+width);
  const nav=await evaluate(`(()=>{const links=Array.from(document.querySelectorAll('.catalog-sidebar nav a'));return {overflow:document.documentElement.scrollWidth>innerWidth,display:getComputedStyle(document.querySelector('.catalog-sidebar nav')).display,links:links.map(a=>({icon:!!a.querySelector('svg'),title:!!a.title,width:a.getBoundingClientRect().width,overflow:getComputedStyle(a).overflow}))};})()`);
  assert.equal(nav.overflow,false,'catalog no horizontal overflow '+width);
  assert.equal(nav.links.length,2);assert.ok(nav.links.every(a=>a.icon&&a.title),'catalog links have icons and accessible titles');
  if(width===840)assert.ok(nav.links.every(a=>a.width===49&&a.overflow==='hidden'),'catalog links collapse to icons');
  if(width===380)assert.equal(nav.display,'none','mobile navigation follows catalog layout');
  await shot('catalog-sidebar-'+width,false);
 }
 console.log('PASS: catalog sidebar icons and responsive layout at 840px, 1280px and 380px.');
 console.log(`PASS: ${checks} M08 rendered UI views at 1280px and 380px; page content, shared shell, modal focus and RLS verified; no horizontal overflow.`);
 console.log('Screenshots:\n'+screenshots.join('\n'));

}finally{
 if(send && ws?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}}
 ws?.close();try{await stopProcess(child,{tree:true});}finally{await stopProcess(server,{graceful:true});}
}
