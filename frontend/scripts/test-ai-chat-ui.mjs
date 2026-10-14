import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { stopProcess } from './campaign-test-process.mjs';

let chrome;
for(const candidate of [process.env.CHROME_PATH,process.env.PROGRAMFILES&&join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),process.env['PROGRAMFILES(X86)']&&join(process.env['PROGRAMFILES(X86)'],'Google/Chrome/Application/chrome.exe')].filter(Boolean)){try{await access(candidate);chrome=candidate;break;}catch{}}
assert.ok(chrome,'Chrome executable required');
const root=join(tmpdir(),'pose-m06-chat-ui');await mkdir(root,{recursive:true});
let server,child,ws,send,checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;};
try{
 let output='';server=spawn(process.execPath,['scripts/test-ai-agent.mjs','--preview-only'],{cwd:new URL('..',import.meta.url),env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 server.stdout.on('data',x=>output+=x);server.stderr.on('data',x=>output+=x);
 for(let i=0;i<150&&!output.includes('PREVIEW READY:');i++){if(server.exitCode!==null)break;await delay(100);}assert.ok(output.includes('PREVIEW READY:'),output);
 child=spawn(chrome,['--headless','--no-sandbox','--disable-gpu','--no-first-run','--disable-background-networking','--remote-debugging-port=3305',`--user-data-dir=${join(root,'chrome-'+Date.now())}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let target;for(let i=0;i<60;i++){try{target=await(await fetch('http://127.0.0.1:3305/json/new?about:blank',{method:'PUT'})).json();if(target.webSocketDebuggerUrl)break;}catch{}await delay(100);}assert.ok(target?.webSocketDebuggerUrl);
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 let next=0;const pending=new Map();ws.addEventListener('message',({data})=>{const m=JSON.parse(data);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result);}});
 send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},10000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async condition=>{for(let i=0;i<100;i++){if(await evaluate(condition))return;await delay(50);}throw Error('Timed out: '+condition+'; '+await evaluate("JSON.stringify({active:document.activeElement?.outerHTML,panel:!!document.querySelector('.ai-panel'),text:document.body.innerText.slice(-1800)})"));};
 const click=label=>evaluate(`document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`);
 const type=text=>evaluate(`(()=>{const e=document.querySelector('#ai-message');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const key=async(shift=false)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13,modifiers:shift?8:0});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,modifiers:shift?8:0});};
 const screenshot=async name=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(root,name+'.png'),Buffer.from(r.data,'base64'));};
 await send('Page.enable');
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
 window.chatRequests=[];window.recognitions=[];window.spoken=[];window.cancelCount=0;
 class Recognition{start(){window.recognitions.push(this);}stop(){this.onend?.();}abort(){this.onend?.();}emit(text,final=false){this.onresult?.({resultIndex:0,results:[{isFinal:final,0:{transcript:text}}]});if(final)this.onend?.();}}
 window.SpeechRecognition=Recognition;window.webkitSpeechRecognition=undefined;
 window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
 Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{lang:'vi-VN'}],cancel(){window.cancelCount++;},speak(u){window.spoken.push(u);}}});
 const originalFetch=window.fetch.bind(window);window.fetch=async(url,options)=>{
 if(url==='/api/ai/chat'){const body=JSON.parse(options.body);window.chatRequests.push(body);await new Promise(r=>setTimeout(r,500));return new Response(JSON.stringify({session:{id:'f6300000-0000-4000-8000-000000000009'},reply:'Tôi là trợ lý AI của TERAVA. Q7-R01 giá thuê 25.000.000 VND/tháng, còn cho thuê.',sources:[{id:'f6300000-0000-4000-8000-000000000003',code:'Q7-R01',name:'Căn hộ 2 phòng ngủ Quận 7',price:25000000,transaction_type:'Rent',price_period:'Month',availability:'Available',updated_at:'2026-10-15T00:00:00Z'}]}),{status:200});}
 return originalFetch(url,options);};`});
 for(const width of [1280,380]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===380});
  await send('Page.navigate',{url:'http://localhost:3300/properties'});await wait("document.readyState==='complete' && !!document.querySelector('.ai-launcher')");await delay(500);await click('Trò chuyện với trợ lý AI');await wait("document.activeElement?.id==='ai-message'");
  check(await evaluate("document.querySelectorAll('.ai-suggestions button').length===3 && !document.querySelector('.ai-switch input').checked"),width+' welcome and explicit consent');
  await screenshot('welcome-'+width);
  await evaluate("document.querySelector('.ai-suggestions button').click()");await wait("!!document.querySelector('.ai-typing')");check(await evaluate("document.querySelector('.ai-switch input').disabled"),'consent locked during request');
  await wait("!!document.querySelector('.ai-source')");check(await evaluate("document.querySelector('.ai-source').innerText.includes('25.000.000 VND/tháng') && document.querySelector('.ai-source').innerText.includes('Cập nhật') && document.querySelector('.ai-switch input').disabled"),'rental card, evidence, consent lock');
  await type('Dòng một');await evaluate("document.querySelector('#ai-message').focus()");await key(true);await wait("document.querySelector('#ai-message').value.includes('\\n')");check(await evaluate('chatRequests.length===1'),'Shift Enter does not send');await key();await wait('chatRequests.length===2');await wait("!document.querySelector('.ai-typing')");
  await click('Nói thay vì gõ');await evaluate("recognitions.at(-1).emit('Tôi cần căn hộ',true)");await wait("document.querySelector('#ai-message').value==='Tôi cần căn hộ'");check(await evaluate("recognitions.at(-1).lang==='vi-VN' && chatRequests.length===2"),'dictation only edits textarea');
  await click('Trò chuyện bằng giọng nói');await wait("document.querySelector('.ai-voice').dataset.state==='listening'");await evaluate("recognitions.at(-1).emit('Tìm căn hộ Quận 7',true)");await wait("document.querySelector('.ai-voice').dataset.state==='thinking'");await wait("document.querySelector('.ai-voice').dataset.state==='speaking'");
  check(await evaluate("spoken.at(-1).lang==='vi-VN' && spoken.at(-1).voice.lang==='vi-VN'"),'Vietnamese synthesis');
  await evaluate("window.beforeEcho=cancelCount;recognitions.at(-1).emit('giá thuê 25.000.000 VND/tháng')");check(await evaluate('cancelCount===beforeEcho'),'reply echo ignored');
  await evaluate("recognitions.at(-1).emit('Tôi muốn đổi khu vực')");check(await evaluate('cancelCount>beforeEcho'),'interim barge-in cancels speech');await evaluate("recognitions.at(-1).emit('Tôi muốn đổi khu vực',true)");await wait('chatRequests.length===4');await wait("document.querySelector('.ai-voice').dataset.state==='speaking'");
  await screenshot('voice-'+width);await evaluate("spoken.at(-1).onend()");await wait("document.querySelector('.ai-voice').dataset.state==='listening'");
  await evaluate("document.querySelector('.ai-voice-end').click()");await wait("!!document.querySelector('#ai-message')");await evaluate("window.stoppedCount=recognitions.length;recognitions.at(-1).onend?.()");check(await evaluate('recognitions.length===stoppedCount'),'ending voice prevents restart');
  await screenshot('reply-'+width);
  check(await evaluate(`(()=>{const p=document.querySelector('.ai-panel').getBoundingClientRect();return document.documentElement.scrollWidth<=${width} && p.left>=0 && p.right<=${width} && document.querySelector('.ai-panel').scrollWidth<=p.width+1;})()`),width+' no overflow');
  await evaluate("document.querySelector('[aria-label=\"Đóng\"]').focus()");await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await wait("document.activeElement?.classList.contains('ai-launcher')");check(true,'Escape restores launcher focus');
 }
 await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;'});
 await send('Page.navigate',{url:'http://localhost:3300/properties'});await wait("document.readyState==='complete' && !!document.querySelector('.ai-launcher')");await delay(500);await click('Trò chuyện với trợ lý AI');await delay(100);
 check(await evaluate("!document.querySelector('[aria-label=\"Nói thay vì gõ\"]')"),'Firefox-like mic hidden');await click('Trò chuyện bằng giọng nói');await wait("!!document.querySelector('.ai-error')");check(await evaluate("document.querySelector('.ai-error').innerText.includes('Chrome hoặc Edge')"),'clear unsupported voice guidance');await screenshot('no-speech-380');
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});check(await evaluate("getComputedStyle(document.querySelector('.ai-send')).transitionDuration==='0s'"),'reduced motion');
 console.log(`PASS: ${checks} M06 chat UI checks at 1280px and 380px; dictation, voice, barge-in, fallback, keyboard and consent.`);
 console.log(`Screenshots: ${root}`);
}finally{
 if(send&&ws?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}}
 ws?.close();try{await stopProcess(child,{tree:true});}finally{await stopProcess(server,{graceful:true});}
}
