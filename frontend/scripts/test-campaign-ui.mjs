// From frontend/: set PGLITE_PATH to an external @electric-sql/pglite directory;
// npx next build; node scripts/test-campaign-ui.mjs. Starts/stops its own fixtures.
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
if(!chrome){console.log('SKIP: M07 UI checks; Chrome not found. Set CHROME_PATH to a Chrome executable.');process.exit(0);}
assert.ok(process.env.PGLITE_PATH,'Set PGLITE_PATH to an external @electric-sql/pglite directory.');
const root=join(tmpdir(),'pose-m07-audience');await mkdir(root,{recursive:true});
let child,server,ws,send,checks=0;
try {
 let output='';server=spawn(process.execPath,['scripts/test-campaign-management.mjs','--preview-only'],{cwd:new URL('..',import.meta.url),env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 server.stdout.on('data',x=>output+=x);server.stderr.on('data',x=>output+=x);
 for(let i=0;i<120 && !output.includes('PREVIEW READY:');i++){if(server.exitCode!==null)break;await delay(100);}
 assert.ok(output.includes('PREVIEW READY:'),'isolated preview ready: '+output);
 child=spawn(chrome,['--headless','--no-sandbox','--disable-gpu','--no-first-run','--disable-background-networking','--remote-debugging-port=3402',`--user-data-dir=${join(root,'isolated-'+Date.now())}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let target;
 for(let i=0;i<40;i++){try{target=await (await fetch('http://127.0.0.1:3402/json/new?about:blank',{method:'PUT'})).json();if(target.webSocketDebuggerUrl)break;}catch{}await delay(250);}
 assert.ok(target?.webSocketDebuggerUrl,'Chrome test target ready');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 let next=0;const pending=new Map();ws.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.id && pending.has(m.id)){const {resolve,reject}=pending.get(m.id);pending.delete(m.id);if(m.error)reject(Error(JSON.stringify(m.error)));else resolve(m.result);}});
 send=(method,params={})=>new Promise((resolve,reject)=>{const n=++next;const timer=setTimeout(()=>{pending.delete(n);reject(Error('Chrome command timeout: '+method));},10000);pending.set(n,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true})).result.value;
 await send('Page.enable');
 for(const width of [1280,380])for(const page of ['list','0','1','2','3','4']){
  const name=`${page==='list' ? 'list':'tab-'+page}-${width}`,file=join(root,name+'.png');
  await send('Emulation.setDeviceMetricsOverride',{width,height:1100,screenWidth:width,screenHeight:1100,deviceScaleFactor:1,mobile:width===380});
  await send('Page.navigate',{url:`http://localhost:3401/fixture${page==='list' ? '':`?detail=1&tab=${page}`}`});
  let ready=false;
  const condition=page==='list' ? "document.querySelectorAll('.campaigns-list-item').length===3":page==='0' ? "document.querySelector('input[value=\"Tư vấn căn hộ — bản nháp\"]')":page==='1' ? "document.querySelector('textarea')":page==='2' ? "document.querySelector('select option[value=\"f7700000-0000-4000-8000-000000000001\"]')":page==='3' ? "document.querySelector('.campaigns-checklist')?.innerText.includes('✓ Ngân sách')":"document.querySelectorAll('.catalog-stats article').length===4";
  for(let i=0;i<60;i++){if(await evaluate(`document.readyState==='complete' && !!(${condition})`)){ready=true;break;}await delay(100);}
  assert.ok(ready,name+' loaded');
  if(page==='1'){const match=await evaluate(`({button:document.body.innerText.includes('Gợi ý theo sản phẩm chiến dịch'),filters:document.querySelectorAll('.campaigns-audience-match-panel input').length,counters:document.body.innerText.includes('Đủ điều kiện'),chips:!!document.querySelector('.campaigns-reason-chips')})`);assert.ok(match.button&&match.filters>=6,name+' match controls');}
  const dimensions=await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})');
  assert.equal(dimensions.width,width,name+' actual viewport');assert.ok(dimensions.scroll<=width,name+' no horizontal overflow: '+JSON.stringify(dimensions));
  if(page==='0'){const text=await evaluate('document.body.innerText');for(const unit of ['(VND)','(giây)','(giờ)','(cuộc/ngày)'])assert.ok(text.includes(unit),name+' unit '+unit);}
  if(page==='3'){
   const state=await evaluate(`({warnings:document.querySelectorAll('.preflight-unmet').length,success:document.querySelectorAll('.preflight-met').length,help:document.querySelector('.preflight-unmet small')?.innerText,buttons:Array.from(document.querySelectorAll('.campaigns-row button')).map(b=>({label:b.innerText,disabled:b.disabled}))})`);
   assert.equal(state.warnings,1,name+' unmet audience warning');assert.equal(state.success,6,name+' met items');assert.ok(state.help.includes('Lưu đối tượng'),name+' repair guidance');
   for(const label of ['Lên lịch','Bắt đầu'])assert.ok(state.buttons.find(b=>b.label===label)?.disabled,name+' rejects '+label);
   assert.equal(state.buttons.find(b=>b.label==='Hủy chiến dịch')?.disabled,false,name+' cancel available');
  }
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(file,Buffer.from(shot.data,'base64'));assert.ok((await stat(file)).size>10000,name+' screenshot');checks++;
 }
 await send('Page.navigate',{url:'http://localhost:3401/fixture?detail=1&ready=1&tab=3'});
 let ready=false;for(let i=0;i<60;i++){if(await evaluate("document.querySelectorAll('.preflight-met').length===7")){ready=true;break;}await delay(100);}assert.ok(ready,'valid campaign preflight loaded');
 assert.ok(await evaluate("Array.from(document.querySelectorAll('.campaigns-row button')).filter(b=>['Lên lịch','Bắt đầu'].includes(b.innerText)).every(b=>!b.disabled)"),'valid campaign actions enabled');
 console.log(`PASS: ${checks} M07 rendered UI views at 1280px and 380px; no horizontal overflow.`);
 console.log(`Screenshots: ${root}`);
}finally{
 if(send && ws?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}}
 ws?.close();try{await stopProcess(child,{tree:true});}finally{await stopProcess(server,{graceful:true});}
}
