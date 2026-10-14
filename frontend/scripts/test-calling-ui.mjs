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

 for(const width of [1280,380])for(const page of ['list','detail','playground','sales']){
  const name=page+'-'+width,file=join(root,name+'.png');
  await send('Emulation.setDeviceMetricsOverride',{width,height:1100,screenWidth:width,screenHeight:1100,deviceScaleFactor:1,mobile:width===380});
  let path='/admin/calls';
  if(page==='sales')path='/sales';
  if(page==='playground')path+='/playground';
  if(page==='detail'){
   const response=await fetch('http://localhost:3500/api/calls',{headers:{Cookie:'pose-access=fixture-admin'}});path+='/'+(await response.json()).items[0].id;
  }
  await send('Page.navigate',{url:'http://localhost:3501/fixture?path='+encodeURIComponent(path)});
  const condition=page==='sales'?"document.querySelector('.calls-sales')":page==='list'?"document.querySelectorAll('.calls-item').length===2":page==='detail'?"document.querySelector('h3')?.innerText.includes('Chi')":"document.querySelector('select option[value=\"f7800000-0000-4000-8000-000000000001\"]')";
  let ready=false;for(let n=0;n<80;n++){if(await evaluate("document.readyState==='complete' && !!("+condition+")")){ready=true;break;}await delay(100);}
  assert.ok(ready,name+' loaded');
  const dimensions=await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})');assert.equal(dimensions.width,width);assert.ok(dimensions.scroll<=width,name+' no overflow '+JSON.stringify(dimensions));
  if(page==='list'){
   assert.ok(await evaluate("document.body.innerText.includes('Gi'+String.fromCharCode(7843)+' l'+String.fromCharCode(7853)+'p')"),'simulator badge');
   await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.innerText.startsWith('D')).click()");await delay(100);
   assert.ok(await evaluate("!!document.querySelector('[role=dialog] textarea[required]')"),'reason dialog');
  }
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(file,Buffer.from(shot.data,'base64'));assert.ok((await stat(file)).size>10000,name+' screenshot');checks++;
 }
 console.log(`PASS: ${checks} M08 rendered UI views at 1280px and 380px; no horizontal overflow.`);
 console.log(`Screenshots: ${root}`);
}finally{
 if(send && ws?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}}
 ws?.close();try{await stopProcess(child,{tree:true});}finally{await stopProcess(server,{graceful:true});}
}
