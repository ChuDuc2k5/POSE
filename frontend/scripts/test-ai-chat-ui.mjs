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
const root=join(tmpdir(),'pose-m06-cards');await mkdir(root,{recursive:true});
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
 const wait=async condition=>{for(let i=0;i<100;i++){if(await evaluate(condition))return;await delay(50);}throw Error('Timed out: '+condition+'; '+await evaluate("JSON.stringify({active:document.activeElement?.tagName,panel:!!document.querySelector('.ai-panel'),error:document.querySelector('.ai-error')?.textContent,text:document.body.innerText.slice(-1800)})"));};
 const click=label=>evaluate(`document.querySelector('[aria-label=${JSON.stringify(label==='Mở trợ lý AI toàn màn hình'?'Mở toàn màn hình':label.startsWith('Thu nh')?'Thu nhỏ':label)}]').click()`);
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
 if(url==='/api/ai/chat'){const body=JSON.parse(options.body);window.chatRequests.push(body);await new Promise(r=>setTimeout(r,500));const result={session:{id:'f6300000-0000-4000-8000-000000000009'},reply:'Tôi là trợ lý AI của TERAVA. Q7-R01 giá thuê 25.000.000 VND/tháng, còn cho thuê.',sources:[{id:'f6300000-0000-4000-8000-000000000003',code:'Q7-R01',name:'Căn hộ 2 phòng ngủ Quận 7',number:1,cover_id:null,area:80,bedrooms:2,location:'Quận 7',reason:'Gần chợ và trường học.',price:25000000,transaction_type:'Rent',price_period:'Month',availability:'Available',updated_at:'2026-10-15T00:00:00Z'}]};
 window.chatSequence=(window.chatSequence||0)+(body.session_id?0:1);result.session.id=body.session_id||(window.chatSequence===1?'f6300000-0000-4000-8000-000000000009':'f6300000-0000-4000-8000-0000000001'+String(window.chatSequence).padStart(2,'0'));if(body.message==='FORMAT_TEST')result.reply='**đậm** *nghiêng*\\n- một\\n- hai\\n1. một\\n2. hai\\n[1] <img src=x onerror="window.__xss=1">';
 // Same SSE wire format as the backend (event name on its own line, no type in data): the widget always asks for text/event-stream.
 const sse=[['meta',{session_id:result.session.id,scope:'in_scope',sources:result.sources,related:[]}],...result.reply.match(/.{1,48}/gs).map(text=>['delta',{text}]),['done',{message:result.reply,scope:'in_scope',blocked:false,guard:null}]].map(([event,data])=>'event: '+event+'\\ndata: '+JSON.stringify(data)+'\\n\\n').join('');
 return new Response(sse,{status:200,headers:{'Content-Type':'text/event-stream; charset=utf-8'}});}
 return originalFetch(url,options);};`});
 for(const width of [1280,380]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===380});
  await send('Page.navigate',{url:'http://localhost:3300/properties'});await delay(500);await wait("document.readyState==='complete' && !!document.querySelector('.ai-launcher')");await delay(500);await click('Trò chuyện với trợ lý AI');await wait("document.activeElement?.id==='ai-message'");
  check(await evaluate("document.querySelectorAll('.ai-suggestions button').length===3 && !document.querySelector('.ai-switch input').checked"),width+' welcome and explicit consent');
  await screenshot('welcome-'+width);
  await evaluate("document.querySelector('.ai-suggestions button').click()");await wait("!!document.querySelector('.ai-typing')");check(await evaluate("document.querySelector('.ai-switch input').disabled"),'consent locked during request');
  await wait("!!document.querySelector('.ai-property-card')");check(await evaluate("document.querySelector('.ai-source')?.innerText.includes('25.000.000 VND/tháng') && document.querySelector('.ai-property-card') && document.querySelector('.ai-switch input').disabled"),'rental card, evidence, consent lock');
  check(await evaluate("document.querySelectorAll('.ai-property-card').length===1 && document.querySelector('.ai-property-number').textContent==='[1]' && document.querySelector('.ai-property-placeholder') && document.querySelector('.ai-property-reason').textContent.includes('Gần chợ')"),'card placeholder, badge and reason');
  check(await evaluate("document.querySelector('.ai-property-specs').textContent.includes('80') && document.querySelector('.ai-property-location').textContent.includes('Quận 7')"),'card specs and live location');
  check(await evaluate("document.querySelector('.ai-property-actions a[href=\"/sign-in\"]')?.textContent.includes('Đăng nhập')"),'guest card action requests sign-in');
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
  await evaluate("sessionStorage.clear()");
 }

 await send('Page.navigate',{url:'http://localhost:3300/properties'});await delay(500);await wait("!!document.querySelector('.ai-launcher')");await click('Trò chuyện với trợ lý AI');
 await evaluate("document.querySelector('.ai-switch input').click()");await type('Câu hỏi trước khi xem nhà');await click('Gửi');await wait("!!document.querySelector('.ai-source')");
 await type('Bản nháp đang viết');
 await wait("!!document.querySelector('.discovery-card')");
 await evaluate("window.originalSession=chatRequests[0];window.originalMessages=document.querySelector('.ai-log').innerText;window.documentMarker=123;window.card=document.querySelector('.discovery-card a[href^=\"/properties/\"]');window.nextProperty=card.getAttribute('href').split('/').at(-1);card.click()");
 await wait("location.pathname==='/properties/'+window.nextProperty && !!document.querySelector('.ai-panel') && document.querySelector('.ai-panel-head').innerText.includes('Đang xem:')");
 check(await evaluate("documentMarker===123 && document.querySelector('.ai-log').innerText===originalMessages && document.querySelector('#ai-message').value==='Bản nháp đang viết' && document.querySelector('.ai-switch input').checked"),'client navigation retains open panel, messages, consent and draft');
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await screenshot('property-context-1280');
 await send('Emulation.setDeviceMetricsOverride',{width:380,height:900,deviceScaleFactor:1,mobile:true});await screenshot('property-context-380');
 await type('Câu hỏi về căn đang xem');await click('Gửi');await wait('chatRequests.length===2');await wait("!document.querySelector('.ai-typing')");
 check(await evaluate("chatRequests[1].session_id==='f6300000-0000-4000-8000-000000000009' && chatRequests[1].property_id===nextProperty && chatRequests[1].history.length===2 && chatRequests[1].store_transcript"),'next request retains session and history with current property');
 await type('Bản nháp sau tải lại');await send('Page.reload');await delay(500);await wait("!!document.querySelector('.ai-panel') && document.querySelectorAll('.ai-row').length===4");
 check(await evaluate("document.querySelector('#ai-message').value==='Bản nháp sau tải lại' && document.querySelector('.ai-switch input').checked"),'reload restores conversation, consent, open panel and draft');
 await click('Trò chuyện bằng giọng nói');await wait("document.querySelector('.ai-voice')?.dataset.state==='listening'");
 await evaluate("window.activeMic=recognitions.at(-1);window.cancelBefore=cancelCount;document.querySelector('a[href=\"/properties\"]').click()");
 await wait("location.pathname==='/properties' && !!document.querySelector('#ai-message')");
 check(await evaluate("activeMic.onend===null && activeMic.onresult===null && activeMic.onerror===null && cancelCount>cancelBefore && document.querySelectorAll('.ai-row').length===4"),'navigation stops recognition and speech without losing messages');
 await type('Draft across filters');await evaluate("(()=>{const e=document.querySelector('select[name=sort]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'priceAsc');e.dispatchEvent(new Event('change',{bubbles:true}));})()");
 await wait("location.search.includes('sort=priceAsc') && !!document.querySelector('.ai-panel') && document.querySelector('.property-results').getAttribute('aria-busy')==='false'");
 check(await evaluate("document.querySelectorAll('.ai-row').length===4 && document.querySelector('#ai-message').value==='Draft across filters'"),'filter navigation and page remount retain messages and draft');
 await click('Cuộc trò chuyện mới');await wait("document.querySelectorAll('.ai-row').length===0");
 check(await evaluate("(()=>{const s=JSON.parse(sessionStorage.getItem('terava-chat-v1'));return s.messages.length===0 && !s.session_id && !s.store && s.draft==='';})()"),'new conversation clears persisted session, messages, draft and consent');
 await type('Riêng tư của khách');await click('Gửi');await wait("!!document.querySelector('.ai-source')");
 await send('Network.setCookie',{name:'pose-access',value:'fixture-User',url:'http://localhost:3300'});
 await send('Page.reload');await delay(500);await wait("!!document.querySelector('.ai-launcher')");await click('Trò chuyện với trợ lý AI');
 check(await evaluate("document.querySelectorAll('.ai-row').length===0 && JSON.parse(sessionStorage.getItem('terava-chat-v1')).ownerKey==='f6000000-0000-4000-8000-000000000001'"),'signing in discards guest conversation');
 await type('Riêng tư tài khoản thứ nhất');await click('Gửi');await wait("!!document.querySelector('.ai-source')");
 await evaluate("Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Gặp chuyên viên').click()");
 await evaluate("document.querySelector('a[href=\"/customer\"]').click()");await wait("location.pathname==='/customer' && !!document.querySelector('.ai-handoff')");
 check(await evaluate("document.querySelectorAll('.ai-row').length===2"),'customer home shares conversation and handoff state');
 await evaluate("document.querySelector('a[href^=\"/properties/\"]').click()");await wait("location.pathname.startsWith('/properties/') && !!document.querySelector('.ai-handoff')");
 check(true,'handoff form stays open on client navigation');
 await evaluate("Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Đăng xuất').click()");await wait("location.pathname==='/sign-in'");
 check(await evaluate("!document.querySelector('.ai-chat') && !sessionStorage.getItem('terava-chat-v1')"),'sign out clears storage and hides assistant on auth page');
 await send('Network.setCookie',{name:'pose-access',value:'fixture-Other',url:'http://localhost:3300'});
 await send('Page.navigate',{url:'http://localhost:3300/properties'});await delay(500);await wait("!!document.querySelector('.ai-launcher')");await click('Trò chuyện với trợ lý AI');
 check(await evaluate("document.querySelectorAll('.ai-row').length===0 && JSON.parse(sessionStorage.getItem('terava-chat-v1')).ownerKey==='f6000000-0000-4000-8000-000000000002'"),'another signed-in account cannot see previous conversation');
 await type('Tài khoản thứ hai');await click('Gửi');await wait("!!document.querySelector('.ai-source')");
 await send('Network.setCookie',{name:'pose-access',value:'fixture-User',url:'http://localhost:3300'});await send('Page.reload');await delay(500);await wait("!!document.querySelector('.ai-launcher')");await click('Trò chuyện với trợ lý AI');
 check(await evaluate("document.querySelectorAll('.ai-row').length===0"),'direct account change discards previous account conversation');
 await evaluate("sessionStorage.setItem('terava-chat-v1','broken JSON')");await send('Page.reload');await delay(500);await wait("!!document.querySelector('.ai-launcher')");
 check(true,'malformed storage safely discarded');
 await evaluate("sessionStorage.setItem('terava-chat-v1',JSON.stringify({ownerKey:'f6000000-0000-4000-8000-000000000001',messages:Array.from({length:34},(_,i)=>({role:'user',content:'message '+i})),open:true,store:false,draft:''}))");
 await send('Page.reload');await delay(500);await wait("document.querySelectorAll('.ai-row').length===30");
 check(await evaluate("JSON.parse(sessionStorage.getItem('terava-chat-v1')).messages.length===30 && document.querySelector('.ai-bubble').textContent==='message 4'"),'only the last 30 messages are restored and persisted');
 await click('Đóng');await send('Page.reload');await delay(500);await wait("!!document.querySelector('.ai-launcher')");
 check(true,'closed panel remains closed after reload');
 await send('Network.deleteCookies',{name:'pose-access',url:'http://localhost:3300'});await evaluate('sessionStorage.clear()');
 const blockedStorage=await send('Page.addScriptToEvaluateOnNewDocument',{source:"Object.defineProperty(window,'sessionStorage',{get(){throw new Error('Storage blocked');}})"});
 await send('Page.navigate',{url:'http://localhost:3300/properties'});await delay(500);await wait("!!document.querySelector('.ai-launcher')");await click('Trò chuyện với trợ lý AI');await type('Storage unavailable');await click('Gửi');await wait("!!document.querySelector('.ai-source')");
 check(true,'conversation works when storage reads and writes throw');
 await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:blockedStorage.identifier});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;'});
 await send('Page.navigate',{url:'http://localhost:3300/properties'});await delay(500);await wait("document.readyState==='complete' && !!document.querySelector('.ai-launcher')");await delay(500);await click('Trò chuyện với trợ lý AI');await delay(100);
 check(await evaluate("!document.querySelector('[aria-label=\"Nói thay vì gõ\"]')"),'Firefox-like mic hidden');await click('Trò chuyện bằng giọng nói');await wait("!!document.querySelector('.ai-error')");check(await evaluate("document.querySelector('.ai-error').innerText.includes('Chrome hoặc Edge')"),'clear unsupported voice guidance');await screenshot('no-speech-380');
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});check(await evaluate("getComputedStyle(document.querySelector('.ai-send')).transitionDuration==='0s'"),'reduced motion');
 await send('Network.setCookie',{name:'pose-access',value:'fixture-Admin',url:'http://localhost:3300'});await send('Page.navigate',{url:'http://localhost:3300/admin'});await delay(500);await wait("!!document.querySelector('.ai-usage-panel')");await screenshot('admin-usage-1280');
 // Full-page chat shares the widget state and stream implementation.
 await send('Page.navigate',{url:'http://localhost:3300/properties'});await delay(500);await wait("!!document.querySelector('.ai-launcher')");await evaluate("document.querySelector('.ai-launcher').click()");
 await evaluate("document.querySelector('.ai-title').click()");await wait("location.pathname==='/tro-ly-ai' && !!document.querySelector('.ai-chat-full .ai-panel')");
 check(await evaluate("document.querySelectorAll('.ai-row').length===0 && !!document.querySelector('.ai-full-suggestions button')"),'header title opens empty full page');
 await evaluate("document.querySelector('.ai-full-suggestions button').click()");await wait("document.querySelectorAll('.ai-row').length===2 && !!document.querySelector('.ai-property-card')");
 check(await evaluate("!!document.querySelector('.ai-property-card')"),'empty full page suggestion sends and renders a card');
 await evaluate("document.querySelector('[title^=\"Thu\"]').click()");await wait("location.pathname==='/properties' && document.querySelectorAll('.ai-row').length===2");
 await evaluate("document.querySelector('a[href^=\"/properties/\"]').click()");await wait("location.pathname.startsWith('/properties/') && !!document.querySelector('.ai-panel')");
 const returnPropertyPath=await evaluate('window.returnPropertyPath=location.pathname+location.search');
 await evaluate("document.querySelector('.ai-title').click()");await wait("location.pathname==='/tro-ly-ai'");
 await type('Find a townhouse');await evaluate("document.querySelector('.ai-send').click()");await wait("document.querySelectorAll('.ai-row').length===4 && !document.querySelector('.ai-typing')");
 await evaluate("document.querySelector('[title^=\"Thu\"]').click()");await wait("location.pathname+location.search===window.returnPropertyPath && document.querySelectorAll('.ai-row').length===4");
 check(await evaluate(`window.returnPropertyPath===${JSON.stringify(returnPropertyPath)}`),'full page returns to the same property with both turns');
 await send('Network.deleteCookies',{name:'pose-access',url:'http://localhost:3300'});await evaluate('sessionStorage.clear()');
 await send('Page.navigate',{url:'http://localhost:3300/properties'});await delay(500);await wait("!!document.querySelector('.ai-launcher')");await evaluate("document.querySelector('.ai-launcher').click()");
 await type('Find an apartment in District 7');await evaluate("document.querySelector('.ai-send').click()");await wait("document.querySelectorAll('.ai-row').length===2 && !!document.querySelector('.ai-property-card')");
 await click('Mở trợ lý AI toàn màn hình');await wait("location.pathname==='/tro-ly-ai' && !!document.querySelector('.ai-chat-full .ai-panel')");
 check(await evaluate("document.querySelectorAll('.ai-row').length===2 && !!document.querySelector('.ai-property-card') && document.querySelector('.ai-launcher')===null"),'full page preserves conversation and hides launcher');
  await send('Emulation.setDeviceMetricsOverride',{width:380,height:800,deviceScaleFactor:1,mobile:true});
  check(await evaluate("(()=>{const header=document.querySelector('.site-header').getBoundingClientRect(),panel=document.querySelector('.ai-panel').getBoundingClientRect(),composer=document.querySelector('.ai-composer')?.getBoundingClientRect()||document.querySelector('#ai-message').getBoundingClientRect(),log=document.querySelector('.ai-log');return panel.top<=header.bottom+24&&panel.bottom<=innerHeight+0.5&&composer.top>=0&&composer.bottom<=innerHeight+0.5&&document.documentElement.scrollHeight<=innerHeight+2&&log.scrollHeight>log.clientHeight;})()"),'full page fits 380x800 and message log scrolls');
  await screenshot('bigchat-380');await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await screenshot('bigchat-1280');
  await type('Find a townhouse');await evaluate("document.querySelector('.ai-send').click()");await wait("document.querySelectorAll('.ai-row').length===4 && !document.querySelector('.ai-typing')");
  check(await evaluate("(()=>{const header=document.querySelector('.site-header').getBoundingClientRect(),panel=document.querySelector('.ai-panel').getBoundingClientRect(),composer=document.querySelector('.ai-composer')?.getBoundingClientRect()||document.querySelector('#ai-message').getBoundingClientRect(),log=document.querySelector('.ai-log');return panel.top<=header.bottom+24&&panel.bottom<=innerHeight+0.5&&composer.top>=0&&composer.bottom<=innerHeight+0.5&&document.documentElement.scrollHeight<=innerHeight+2&&log.scrollHeight>log.clientHeight;})()"),'full page fits 1280x800 and message log scrolls');
 await click('Thu nhỏ trợ lý AI');await wait("location.pathname==='/properties' && document.querySelectorAll('.ai-row').length===4");
 check(await evaluate("document.documentElement.scrollWidth<=1280"),'full page returns to widget without overflow');
 // Full-page acceptance coverage: history, privacy masking, rich replies, citations and latest-message affordance.
  await evaluate("(()=>{localStorage.clear();sessionStorage.clear();return true})()");await send('Page.navigate',{url:'http://localhost:3300/properties?reset='+Date.now()});await delay(600);await wait("!!document.querySelector('.ai-launcher')");
  await evaluate("(()=>{localStorage.clear();sessionStorage.clear();location.href='/properties';return true})()");await delay(600);await wait("!!document.querySelector('.ai-launcher')");await evaluate("document.querySelector('.ai-launcher').click()");await wait("!!document.querySelector('.ai-title')");await evaluate("document.querySelector('.ai-title').click()");await wait("location.pathname==='/tro-ly-ai' && !!document.querySelector('.ai-history')");
 check(await evaluate("(()=>{const h=document.querySelector('.ai-history'),p=document.querySelector('.ai-panel');return getComputedStyle(h).display!=='none'&&getComputedStyle(h).backgroundColor!==getComputedStyle(p).backgroundColor;})()"),'1280 history sidebar and distinct chat surface');
 await evaluate("localStorage.setItem('terava-chat-history-v1',JSON.stringify([{id:'f7400000-0000-4000-8000-000000000002',title:'Second private conversation',time:new Date().toISOString(),messages:[{role:'user',content:'Second private conversation'}]},{id:'f7400000-0000-4000-8000-000000000001',title:'0901234567 a@b.vn',time:new Date().toISOString(),messages:[{role:'user',content:'0901234567 a@b.vn'},{role:'assistant',content:'**đậm** *nghiêng*\\n- một\\n1. một\\n[1] <img src=x onerror=\\\"window.__xss=1\\\">'}]}]))");await send('Page.navigate',{url:'http://localhost:3300/tro-ly-ai?history='+Date.now()});await delay(500);await wait("document.querySelectorAll('.ai-history-item').length===2");
  await evaluate("(()=>{const h=JSON.parse(localStorage.getItem('terava-chat-history-v1'));h[1].messages[1].sources=[{id:'f6300000-0000-4000-8000-000000000003',code:'Q7-R01',name:'Căn hộ 2 phòng ngủ Quận 7',number:1,cover_id:null,area:80,bedrooms:2,location:'Quận 7',reason:'Gần chợ và trường học.',price:25000000,transaction_type:'Rent',price_period:'Month',availability:'Available',updated_at:'2026-10-15T00:00:00Z'}];localStorage.setItem('terava-chat-history-v1',JSON.stringify(h));return true})()");await send('Page.navigate',{url:'http://localhost:3300/tro-ly-ai?history-sources='+Date.now()});await delay(500);await wait("document.querySelectorAll('.ai-history-item').length===2");
  check(await evaluate("(()=>{const titles=[...document.querySelectorAll('.ai-history-item strong')].map(e=>e.textContent);return titles.length===2&&titles.every(t=>!/[0-9]{7,}|@/.test(t));})()"),'history lists two masked conversations without PII');
 await evaluate("document.querySelectorAll('.ai-history-item>button:first-child')[1].click()");await wait("document.querySelector('.ai-bubble')?.textContent.includes('0901234567')");check(true,'clicking the first conversation restores its messages');await evaluate("document.querySelector('.ai-history-delete').click()");await wait("document.querySelectorAll('.ai-history-item').length===1");check(true,'local history delete removes an item');
  await wait("!!document.querySelector('.ai-answer strong') && !!document.querySelector('.ai-answer em')");
 check(await evaluate("(()=>{const a=document.querySelector('.ai-answer');return !!a.querySelector('strong')&&!!a.querySelector('em')&&!!a.querySelector('ul li')&&!!a.querySelector('ol li')&&!a.innerText.includes('**')&&!window.__xss&&!a.querySelector('img');})()"),'safe markdown lists and XSS-safe reply rendering');await evaluate("document.querySelector('.ai-citation-chip').click()");check(await evaluate("!!document.querySelector('.is-citation-target')"),'citation chip highlights card one');check(await evaluate("getComputedStyle(document.querySelector('.ai-log')).scrollbarWidth==='thin'"),'message log has a thin scrollbar');
  await evaluate("(()=>{const e=document.querySelector('.ai-log');e.style.height='400px';e.style.flex='none';e.style.overflowY='auto';e.style.scrollBehavior='auto';e.scrollTop=Math.max(0,(e.scrollHeight-e.clientHeight)/2);e.dispatchEvent(new Event('scroll',{bubbles:true}));return true})()");await delay(100);await type('FORMAT_TEST');await evaluate("document.querySelector('.ai-send').click()");await wait("!!document.querySelector('.ai-latest')");await evaluate("document.querySelector('.ai-latest').click()");check(await evaluate("(()=>{const e=document.querySelector('.ai-log');return e.scrollTop+e.clientHeight>=e.scrollHeight-24;})()"),'latest-message button returns to bottom');
  await send('Emulation.setDeviceMetricsOverride',{width:380,height:900,deviceScaleFactor:1,mobile:true});await send('Page.navigate',{url:'http://localhost:3300/tro-ly-ai?mobile='+Date.now()});await delay(500);await wait("!!document.querySelector('.ai-history-mobile')");await evaluate("document.querySelector('.ai-history-mobile').click()");check(await evaluate("document.querySelector('.ai-history.is-open')&&document.documentElement.scrollWidth<=380"),'mobile history drawer opens without horizontal overflow');await evaluate("document.querySelector('.ai-history-item>button:first-child').click()");await wait("!document.querySelector('.ai-history.is-open')");check(true,'mobile history drawer closes after restore');
 console.log(`PASS: ${checks} M06 chat UI checks at 1280px and 380px; full-page chat, dictation, voice, barge-in, fallback, keyboard and consent.`);
 console.log(`Screenshots: ${root}`);
}finally{
 if(send&&ws?.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch{}}
 ws?.close();try{await stopProcess(child,{tree:true});}finally{await stopProcess(server,{graceful:true});}
}
