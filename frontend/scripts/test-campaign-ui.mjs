import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

// Run against test-campaign-management.mjs --preview; all data is isolated.
const chrome=process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const root=join(tmpdir(),'pose-m07-ui');await mkdir(root,{recursive:true});
const child=spawn(chrome,['--headless','--disable-gpu','--no-first-run','--disable-background-networking','--remote-debugging-port=3402',`--user-data-dir=${join(root,'isolated-'+Date.now())}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws,checks=0;
try {
 let target;
 for(let i=0;i<40;i++){try{target=await (await fetch('http://127.0.0.1:3402/json/new?about:blank',{method:'PUT'})).json();if(target.webSocketDebuggerUrl)break;}catch{}await delay(250);}
 assert.ok(target?.webSocketDebuggerUrl,'Chrome test target ready');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 let next=0;const pending=new Map();ws.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.id && pending.has(m.id)){const {resolve,reject}=pending.get(m.id);pending.delete(m.id);if(m.error)reject(Error(JSON.stringify(m.error)));else resolve(m.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++next;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true})).result.value;
 await send('Page.enable');
 for(const width of [1280,380])for(const page of ['list','0','1','2','3','4']){
  const name=`${page==='list' ? 'list':'tab-'+page}-${width}`,file=join(root,name+'.png');
  await send('Emulation.setDeviceMetricsOverride',{width,height:1100,screenWidth:width,screenHeight:1100,deviceScaleFactor:1,mobile:width===380});
  await send('Page.navigate',{url:`http://localhost:3401/fixture${page==='list' ? '':`?detail=1&tab=${page}`}`});
  let ready=false;
  const condition=page==='list' ? "document.querySelector('.campaigns-list-item')":page==='0' ? "document.querySelector('input[value=\"Thiếu nhà cung cấp\"]')":page==='1' ? "document.querySelector('textarea')":page==='2' ? "document.querySelectorAll('select option').length>4":page==='3' ? "document.querySelector('.campaigns-checklist')?.innerText.includes('✓ Ngân sách')":"document.querySelectorAll('.catalog-stats article').length===4";
  for(let i=0;i<60;i++){if(await evaluate(`document.readyState==='complete' && !!(${condition})`)){ready=true;break;}await delay(100);}
  assert.ok(ready,name+' loaded');
  const dimensions=await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})');
  assert.equal(dimensions.width,width,name+' actual viewport');assert.ok(dimensions.scroll<=width,name+' no horizontal overflow: '+JSON.stringify(dimensions));
  if(page==='0'){const text=await evaluate('document.body.innerText');for(const unit of ['(VND)','(giây)','(giờ)','(cuộc/ngày)'])assert.ok(text.includes(unit),name+' unit '+unit);}
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(file,Buffer.from(shot.data,'base64'));assert.ok((await stat(file)).size>10000,name+' screenshot');checks++;
 }
 console.log(`PASS: ${checks} M07 rendered UI views at 1280px and 380px; no horizontal overflow.`);
 console.log(`Screenshots: ${root}`);
}finally{ws?.close();child.kill();}
