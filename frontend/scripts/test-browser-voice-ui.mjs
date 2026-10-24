import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { stopProcess } from './campaign-test-process.mjs';
import * as fixture from './calling-test-process.mjs';
let chrome;
for(const candidate of [process.env.CHROME_PATH,process.env.PROGRAMFILES&&join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),process.env['PROGRAMFILES(X86)']&&join(process.env['PROGRAMFILES(X86)'],'Google/Chrome/Application/chrome.exe'),process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,'Google/Chrome/Application/chrome.exe')].filter(Boolean)){try{await access(candidate);chrome=candidate;break;}catch{}}
if(!chrome){console.log('SKIP: browser voice UI; Chrome not found.');await fixture.closeCallingFixture();process.exit(0);}
const root=join(tmpdir(),'pose-m08-voice-ui');await mkdir(root,{recursive:true});
let child,ws,send,checks=0;
const network=[];
try{
 await fixture.startCallingFixture();
 child=spawn(chrome,['--headless','--no-sandbox','--disable-gpu','--no-first-run','--disable-background-networking','--remote-debugging-port=3502',`--user-data-dir=${join(root,'isolated-'+Date.now())}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let target;for(let n=0;n<40;n++){try{target=await(await fetch('http://127.0.0.1:3502/json/new?about:blank',{method:'PUT'})).json();if(target.webSocketDebuggerUrl)break;}catch{}await delay(250);}
 assert.ok(target?.webSocketDebuggerUrl,'Chrome target ready');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 let next=0;const pending=new Map();ws.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.method==='Network.requestWillBeSent'&&m.params.request.url.includes('socket.io'))network.push(m.params.request.url);if(m.method==='Network.loadingFailed')network.push(m.params.errorText);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result);}});
 send=(method,params={})=>new Promise((resolve,reject)=>{const n=++next,timer=setTimeout(()=>{pending.delete(n);reject(Error('Chrome timeout: '+method));},10000);pending.set(n,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true})).result.value;
 const waitFor=async(expression,label)=>{for(let n=0;n<100;n++){if(await evaluate(`Boolean(${expression})`))return;await delay(100);}throw Error(label+'; '+await evaluate('document.body.innerText'));};
 await send('Page.enable');await send('Network.enable');
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
 window.__spoken=[];window.__cancels=0;
 class Recognition{start(){window.__recognition=this;}stop(){}abort(){}emit(text,final){this.onresult?.({resultIndex:0,results:[{isFinal:final,0:{transcript:text}}]});}}
 window.SpeechRecognition=Recognition;
 window.__SpeechRecognitionMock=Recognition;
 window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
 Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{name:'Tiếng Việt kiểm thử',lang:'vi-VN'}],addEventListener(){},removeEventListener(){},cancel(){window.__cancels++;},speak(u){window.__spoken.push(u.text);window.__speech=u;}}});
 navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[{stop(){window.__micStopped=true;}}]});
 window.AudioContext=class{createAnalyser(){return{fftSize:256,getByteTimeDomainData(a){a.fill(128);}};}createMediaStreamSource(){return{connect(){}};}close(){return Promise.resolve();}};
 `});
 const screenshots=[];
 for(const width of [1280,380]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width===380});
  await send('Page.navigate',{url:'http://localhost:3501/fixture?role=admin&path=/admin/calls/playground'});
  await waitFor("document.querySelector('select option[value=\"f7800000-0000-4000-8000-000000000001\"]')",'published script');
  await evaluate("(()=>{const select=document.querySelector('.calls-playground select');select.value='f7800000-0000-4000-8000-000000000001';select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('input[name=mode]').click();})()");
  await waitFor("document.querySelector('.calls-voice')",'voice mode');await evaluate("document.querySelector('.calls-voice .primary').click()");
  await waitFor('window.__recognition&&window.__spoken.length===1','spoken greeting');
  assert.ok(await evaluate("document.querySelector('.calls-voice').innerText.includes('Tiếng Việt kiểm thử')"),'Vietnamese voice displayed');checks++;
  assert.ok(await evaluate("window.__recognition.lang==='vi-VN'&&window.__recognition.interimResults===true"),'Vietnamese interim recognition');
  for(let n=1;n<=3;n++){await evaluate("window.__recognition.emit('đồng ý',true)");await waitFor(`window.__spoken.length===${n+1}`,'spoken consent '+n);}
  await evaluate('window.__speech.onend()');await waitFor("document.querySelector('[data-voice-state]').innerText==='Đang nghe'",'listening state');
  await evaluate("window.__recognition.emit('Tôi cần tư vấn căn hộ.',true)");await waitFor("window.__spoken.length===5&&document.querySelector('[data-voice-state]').innerText==='Đang nói'",'spoken model turn');
  assert.ok(await evaluate("document.querySelector('.calls-voice').innerText.includes('STT → trả lời:')&&document.querySelector('.calls-voice').innerText.includes('Bản chép lời')"),'latency and consent displayed');checks++;
  const before=await evaluate('window.__cancels');await evaluate("window.__recognition.emit('Xin ngắt lời',false)");assert.ok(await evaluate(`window.__cancels>${before}`),'interim speech cancels synthesis immediately');
  assert.equal(await evaluate("document.querySelector('.calls-interim').innerText"),'Xin ngắt lời');checks++;
  await evaluate("window.__recognition.emit('Xin tư vấn thêm khu vực.',true)");await waitFor('window.__spoken.length===6','reply after interruption');
  const calls=await(await fixture.call('/api/calls')).json(),call=calls.items.find(c=>c.status==='ANSWERED'&&c.phone_e164===null);assert.ok(call,'browser simulation counted as active');
  assert.ok(await fixture.scalar('select count(*)::integer from call_turns where call_id=$1 and interrupted',[call.id])>0,'barge-in stored');checks++;
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'no horizontal overflow');
  const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true}),file=join(root,`voice-${width}.png`);await writeFile(file,Buffer.from(image.data,'base64'));assert.ok((await stat(file)).size>10000);screenshots.push(file);
  await evaluate("Array.from(document.querySelectorAll('.calls-voice button')).find(b=>b.innerText==='Kết thúc cuộc gọi').click()");await waitFor("document.querySelector('[data-voice-state]').innerText==='Đã kết thúc'",'ended');await waitFor('window.__micStopped','microphone released');checks++;
 }
 await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;'});
 await send('Page.navigate',{url:'http://localhost:3501/fixture?role=admin&path=/admin/calls/playground'});
 await waitFor("document.querySelector('select option[value=\"f7800000-0000-4000-8000-000000000001\"]')",'fallback page');
 await evaluate("(()=>{const select=document.querySelector('.calls-playground select');select.value='f7800000-0000-4000-8000-000000000001';select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('input[name=mode]').click();})()");await waitFor("document.querySelector('.calls-voice')",'fallback voice toggle');await evaluate("document.querySelector('.calls-voice .primary').click()");
 await waitFor("document.querySelector('.calls-playground textarea')&&document.querySelector('[role=alert]').innerText.includes('chưa hỗ trợ')",'unsupported speech falls back to text');checks++;
 await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.SpeechRecognition=window.__SpeechRecognitionMock;navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};window.speechSynthesis.getVoices=()=>[];"});
 await send('Page.navigate',{url:'http://localhost:3501/fixture?role=admin&path=/admin/calls/playground'});
 await waitFor("document.querySelector('select option[value=\"f7800000-0000-4000-8000-000000000001\"]')",'permission fallback page');
 await evaluate("(()=>{const select=document.querySelector('.calls-playground select');select.value='f7800000-0000-4000-8000-000000000001';select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('input[name=mode]').click();})()");
 await waitFor("document.querySelector('.calls-voice')?.innerText.includes('Chưa có giọng vi-VN')",'missing Vietnamese voice notice');checks++;
 await evaluate("document.querySelector('.calls-voice .primary').click()");
 await waitFor("document.querySelector('.calls-playground textarea')&&document.querySelector('[role=alert]').innerText.includes('micro')",'permission denial falls back to text');checks++;
 console.log(`PASS: ${checks} browser voice UI checks at 1280px and 380px; spoken turns, interim barge-in, timing, consent, fallback and microphone cleanup.`);
 console.log('Screenshots:\n'+screenshots.join('\n'));
}catch(error){console.error('Voice test network:',network);throw error;}finally{
 if(send&&ws?.readyState===WebSocket.OPEN)try{await send('Browser.close');}catch{}
 ws?.close();try{await stopProcess(child,{tree:true});}finally{await fixture.closeCallingFixture();}
}
