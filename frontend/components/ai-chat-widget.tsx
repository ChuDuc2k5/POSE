'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowUp, AudioLines, Mic, MicOff, Plus, UserRound, X } from 'lucide-react';
import { TeravaMark } from './brand';
import { availabilityLabels } from '@/lib/catalog';
import { chatStorageKey } from '@/lib/chat-storage';

type Source={id:string;code:string;name:string;updated_at:string;price:number|null;availability:keyof typeof availabilityLabels;transaction_type:'Sale'|'Rent';price_period:'Total'|'Month';number?:number};
type PendingAction={id:string;tool:string;summary_vi:string;status?:string;requires_verified_phone?:boolean};
type Message={role:'user'|'assistant';content:string;sources?:Source[];action?:PendingAction};
function validMessage(message:Message){
  return message && (message.role==='user'||message.role==='assistant') && typeof message.content==='string' &&
    (!message.sources || Array.isArray(message.sources) && message.sources.every(source=>source && typeof source.id==='string' && typeof source.name==='string' && typeof source.code==='string' && typeof source.updated_at==='string' && (source.price===null || typeof source.price==='number') && Object.hasOwn(availabilityLabels,source.availability))) && (!message.action || typeof message.action.id==='string' && typeof message.action.summary_vi==='string');
}
type VoiceState='idle'|'listening'|'thinking'|'speaking';
type Recognition={lang:string;interimResults:boolean;continuous:boolean;start():void;stop():void;abort():void;
  onresult:((event:{resultIndex:number;results:ArrayLike<{isFinal:boolean;0:{transcript:string}}>})=>void)|null;onend:(()=>void)|null;onerror:((event:{error:string})=>void)|null};
type RecognitionCtor=new()=>Recognition;

const suggestions=['Căn hộ dưới 3,5 tỷ ở Thủ Đức','Cho thuê căn hộ 2 phòng ngủ Quận 7','Tư vấn đất nền TP.HCM'];
const voiceLabels:Record<VoiceState,string>={idle:'Chạm để nói',listening:'Đang nghe…',thinking:'Đang suy nghĩ…',speaking:'Đang trả lời…'};
const normalize=(value:string)=>value.toLocaleLowerCase('vi').replace(/[^\p{L}\p{N} ]/gu,'').replace(/\s+/g,' ').trim();

function recognitionCtor():RecognitionCtor|null{
  if(typeof window==='undefined')return null;
  const w=window as unknown as {SpeechRecognition?:RecognitionCtor;webkitSpeechRecognition?:RecognitionCtor};
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}
const subscribeNever=()=>()=>{};
function vietnameseVoice(){
  if(typeof window==='undefined' || !window.speechSynthesis)return null;
  return window.speechSynthesis.getVoices().find(v=>v.lang.toLowerCase().startsWith('vi')) || null;
}

export function AiChatWidget({signedIn=false,propertyId,propertyName,ownerKey,visible,navigationKey}:{signedIn?:boolean;propertyId?:string;propertyName?:string;ownerKey:string;visible:boolean;navigationKey:string}){
  const [open,setOpen]=useState(false),[store,setStore]=useState(false),[session,setSession]=useState<string>();
  const [messages,setMessages]=useState<Message[]>([]),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [dictating,setDictating]=useState(false),[voice,setVoice]=useState<VoiceState|null>(null),[heard,setHeard]=useState('');
  const [handoffOpen,setHandoffOpen]=useState(false),[preferred,setPreferred]=useState(''),[handoffKey,setHandoffKey]=useState<string>(),[notice,setNotice]=useState('');
  const [consents,setConsents]=useState<Record<string,{Call:boolean;AIVoice:boolean}>>({}),[deciding,setDeciding]=useState<string>();
  // Speech support is a browser capability: false during server rendering, real value after hydration.
  const speechSupported=useSyncExternalStore(subscribeNever,()=>!!recognitionCtor(),()=>false);
  const pending=useRef(false),recognition=useRef<Recognition|null>(null),voiceOn=useRef(false),log=useRef<HTMLDivElement>(null),input=useRef<HTMLTextAreaElement>(null);
  const history=useRef<Message[]>([]),sessionRef=useRef<string|undefined>(undefined);
  const panel=useRef<HTMLElement>(null),launcher=useRef<HTMLButtonElement>(null),finishSpeech=useRef<(()=>void)|null>(null),voiceEpoch=useRef(0);
  const voiceActive=voice!==null;
  const [restored,setRestored]=useState(false);
  useEffect(()=>{
    try{
      const saved=JSON.parse(window.sessionStorage.getItem(chatStorageKey)||'null');
      if(saved?.ownerKey===ownerKey && Array.isArray(saved.messages) && saved.messages.slice(-30).every(validMessage)){
        const restoredMessages=saved.messages.slice(-30);
        history.current=restoredMessages;sessionRef.current=typeof saved.session_id==='string' ? saved.session_id:undefined;
        // Restore browser-only storage after hydration.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMessages(restoredMessages);setSession(sessionRef.current);setStore(saved.store===true);setOpen(saved.open===true);setText(typeof saved.draft==='string' ? saved.draft.slice(0,2000):'');
      }else window.sessionStorage.removeItem(chatStorageKey);
    }catch{}
    setRestored(true);
  },[ownerKey]);
  useEffect(()=>{
    if(!restored)return;
    try{window.sessionStorage.setItem(chatStorageKey,JSON.stringify({ownerKey,messages:messages.slice(-30),session_id:session,store,open,draft:text}));}catch{}
  },[restored,ownerKey,messages,session,store,open,text]);
  useEffect(()=>{
    voiceOn.current=false;voiceEpoch.current++;
    const r=recognition.current;recognition.current=null;
    if(r){r.onend=null;r.onresult=null;r.onerror=null;r.abort();}
    window.speechSynthesis?.cancel();finishSpeech.current?.();finishSpeech.current=null;
    // Navigation ends the browser voice session while retaining conversation state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDictating(false);setVoice(null);setHeard('');
  },[navigationKey,visible]);

  useEffect(()=>{history.current=messages;sessionRef.current=session;},[messages,session]);
  useEffect(()=>{if(open){if(voiceActive)panel.current?.querySelector<HTMLButtonElement>('.ai-voice-end')?.focus();else input.current?.focus();}},[open,voiceActive]);
  useEffect(()=>{log.current?.scrollTo({top:log.current.scrollHeight,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant':'smooth'});},[messages,busy,heard]);
  useEffect(()=>{const el=input.current;if(el){el.style.height='auto';el.style.height=`${Math.min(el.scrollHeight,160)}px`;}},[text]);
  useEffect(()=>()=>{voiceOn.current=false;voiceEpoch.current++;if(recognition.current){recognition.current.onend=null;recognition.current.onresult=null;recognition.current.onerror=null;recognition.current.abort();}window.speechSynthesis?.cancel();finishSpeech.current?.();},[]);

  const ask=useCallback(async(message:string)=>{
    const content=message.trim();if(!content || pending.current)return null;
    if(content.length>2000){setError('Tin nhắn tối đa 2.000 ký tự.');return null;}
    pending.current=true;setBusy(true);setError('');
    setMessages(list=>[...list,{role:'user',content}]);
    try{
      const response=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({session_id:sessionRef.current,message:content,history:history.current.slice(-10).map(({role,content})=>({role,content})),store_transcript:store,property_id:propertyId || null})});
      if(!response.ok)throw new Error((await response.json()).message);
      if(!response.headers.get('content-type')?.includes('text/event-stream')){const result=await response.json();sessionRef.current=result.session.id;setSession(result.session.id);setMessages(list=>[...list,{role:'assistant',content:result.reply,sources:result.sources,action:result.action}]);return result.reply as string;}
      const reader=response.body?.getReader();if(!reader)throw new Error('Không nhận được nội dung trả lời.');let buffer='',reply='',sources:Source[]=[],action:PendingAction|undefined;setMessages(list=>[...list,{role:'assistant',content:''}]);
      const update=()=>setMessages(list=>{const copy=[...list];copy[copy.length-1]={role:'assistant',content:reply,sources,action};return copy;});
      while(true){const chunk=await reader.read();buffer+=new TextDecoder().decode(chunk.value||new Uint8Array(),{stream:!chunk.done});let end;while((end=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const line=block.split('\n').find(value=>value.startsWith('data:'));if(!line)continue;const event=JSON.parse(line.slice(5));if(event.type==='meta'){sessionRef.current=event.session_id;setSession(event.session_id);sources=event.sources||[];}else if(event.type==='delta')reply+=event.text||'';else if(event.type==='action')action=event.action;else if(event.type==='done')reply=event.message||reply;update();}if(chunk.done)break;}
      return reply;
    }catch(e){
      setMessages(list=>list.slice(0,-1));setText(content);
      setError(e instanceof Error ? e.message:'Chưa thể gửi tin nhắn.');return null;
    }finally{pending.current=false;setBusy(false);}
  },[propertyId,store]);

  async function send(){if(pending.current || dictating)return;const message=text;setText('');if(await ask(message))input.current?.focus();}

  function abortRecognition(){const r=recognition.current;recognition.current=null;if(r){r.onend=null;r.onresult=null;r.onerror=null;r.abort();}}
  function cancelSpeech(){window.speechSynthesis?.cancel();finishSpeech.current?.();finishSpeech.current=null;}

  function listen(onFinal:(said:string)=>void,onInterim?:(said:string)=>void){
    const Ctor=recognitionCtor();if(!Ctor)return false;
    const r=new Ctor();r.lang='vi-VN';r.interimResults=true;r.continuous=false;
    let finalText='';
    r.onresult=event=>{let interim='';for(let i=event.resultIndex;i<event.results.length;i++){const part=event.results[i];if(part.isFinal)finalText+=part[0].transcript;else interim+=part[0].transcript;}onInterim?.(finalText+interim);};
    r.onerror=event=>{if(event.error==='not-allowed'||event.error==='service-not-allowed')setError('Trình duyệt chưa cho phép dùng micro. Hãy cấp quyền micro hoặc gõ câu hỏi.');};
    r.onend=()=>{if(recognition.current===r)recognition.current=null;onFinal(finalText.trim());};
    abortRecognition();recognition.current=r;
    try{r.start();return true;}catch{abortRecognition();setError('Chưa thể bật micro. Hãy thử lại hoặc gõ câu hỏi.');return false;}
  }

  function toggleDictation(){
    if(dictating){recognition.current?.stop();return;}
    const base=text?`${text.trimEnd()} `:'';
    if(listen(said=>{setDictating(false);if(said)setText(base+said);input.current?.focus();},said=>setText(base+said)))setDictating(true);
  }

  function speak(reply:string){
    return new Promise<void>(resolve=>{
      const synth=window.speechSynthesis;if(!synth){resolve();return;}
      const utterance=new SpeechSynthesisUtterance(reply);
      utterance.lang='vi-VN';const v=vietnameseVoice();if(v)utterance.voice=v;
      finishSpeech.current=resolve;
      utterance.onend=()=>{finishSpeech.current=null;resolve();};utterance.onerror=()=>{finishSpeech.current=null;resolve();};
      synth.speak(utterance);
    });
  }

  // Voice mode: listen → ask the assistant → speak the reply → listen again.
  function voiceTurn(){
    if(!voiceOn.current)return;
    setVoice('listening');setHeard('');
    const epoch=voiceEpoch.current;
    if(!listen(said=>{if(voiceOn.current&&epoch===voiceEpoch.current)void respond(said);},setHeard))setVoice('idle');
  }
  async function respond(said:string){
    if(!voiceOn.current)return;
    if(!said){setVoice('idle');return;}
    const epoch=voiceEpoch.current;
    setVoice('thinking');setHeard('');
    const reply=await ask(said);
    if(!voiceOn.current || epoch!==voiceEpoch.current)return;
    if(!reply){setVoice('idle');return;}
    setVoice('speaking');
    // Keep listening while the reply is spoken so the customer can cut in (barge-in).
    // Words that only repeat the reply are the speaker's echo, not the customer.
    let interrupted=false,done=false;
    const spoken=normalize(reply);
    listen(barge=>{if(done || !voiceOn.current || epoch!==voiceEpoch.current || !interrupted)return;done=true;if(barge)void respond(barge);else voiceTurn();},
      partial=>{const p=normalize(partial);if(!interrupted&&p.split(' ').length>=2&&!spoken.includes(p)){interrupted=true;cancelSpeech();}if(interrupted)setHeard(partial);});
    await speak(reply);
    if(voiceOn.current&&epoch===voiceEpoch.current&&!interrupted&&!done){done=true;abortRecognition();voiceTurn();}
  }
  function startVoice(){
    if(!speechSupported || !window.speechSynthesis){setError('Trình duyệt này chưa hỗ trợ trò chuyện giọng nói. Hãy dùng Chrome hoặc Edge, hoặc gõ câu hỏi.');return;}
    voiceOn.current=true;window.speechSynthesis?.getVoices();voiceTurn();
  }
  function stopVoice(){voiceOn.current=false;voiceEpoch.current++;abortRecognition();cancelSpeech();setDictating(false);setVoice(null);setHeard('');}
  function close(){stopVoice();setOpen(false);requestAnimationFrame(()=>launcher.current?.focus());}

  async function decide(id:string,confirm:boolean){
    setDeciding(id);try{const response=await fetch(`/api/ai/actions/${id}/${confirm?'confirm':'cancel'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({consents:confirm?(consents[id]||{Call:false,AIVoice:false}):{}})});const result=await response.json();if(!response.ok)throw new Error(result.message);setNotice(result.message||'Đã cập nhật yêu cầu.');setMessages(list=>list.map(m=>m.action?.id===id?{...m,action:{...m.action,status:result.action?.status|| (confirm?'Confirmed':'Cancelled'),requires_verified_phone:result.action?.no_verified_phone}}:m));}catch(e){setError(e instanceof Error?e.message:'Không thể cập nhật yêu cầu.');}finally{setDeciding(undefined);}
  }

  async function handoff(){
    if(!session || pending.current)return;pending.current=true;setBusy(true);setError('');const key=handoffKey || crypto.randomUUID();setHandoffKey(key);
    try{
      const start=preferred ? new Date(preferred):null;
      const response=await fetch('/api/ai/handoff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:session,summary:'Khách yêu cầu chuyên viên tư vấn qua hội thoại TERAVA',request_key:key,preferred_start:start?.toISOString() || null,preferred_end:start ? new Date(start.getTime()+3600000).toISOString():null})});
      const result=await response.json();if(!response.ok)throw new Error(result.message);setNotice(result.message);setHandoffOpen(false);
    }catch(e){setError(e instanceof Error ? e.message:'Chưa thể bàn giao.');}finally{pending.current=false;setBusy(false);}
  }
  function reset(){try{window.sessionStorage.removeItem(chatStorageKey);}catch{}stopVoice();setPreferred('');sessionRef.current=undefined;setSession(undefined);setMessages([]);setStore(false);setNotice('');setHandoffKey(undefined);setError('');setText('');setHandoffOpen(false);}

  if(!visible || !restored)return null;
  return <aside className="ai-chat">
    {open && <section ref={panel} id="ai-chat-panel" className="ai-panel" role="dialog" aria-label="Trợ lý AI TERAVA" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const nodes=panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],textarea:not(:disabled),input:not(:disabled)');if(nodes?.length){const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}}}>
      <header className="ai-panel-head">
        <span className="ai-avatar"><TeravaMark size={26}/></span>
        <div><h2>Trợ lý TERAVA</h2><small>Trợ lý AI · tư vấn bất động sản</small>{propertyName && <small>Đang xem: {propertyName}</small>}</div>
        <button type="button" className="ai-icon" disabled={busy} onClick={()=>{reset();requestAnimationFrame(()=>input.current?.focus());}} title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới"><Plus size={18}/></button>
        <button type="button" className="ai-icon" onClick={close} title="Đóng" aria-label="Đóng"><X size={18}/></button>
      </header>

      <div className="ai-log" ref={log} role="log" aria-live="polite" aria-relevant="additions">
        {!messages.length && <div className="ai-welcome">
          <span className="ai-welcome-mark"><TeravaMark size={44}/></span>
          <h3>Xin chào! Tôi có thể giúp gì cho bạn?</h3>
          <p>Tôi là trợ lý AI của TERAVA, trả lời dựa trên dữ liệu bất động sản đã công bố. Chuyên viên sẽ xác nhận mọi đề nghị.</p>
          <div className="ai-suggestions">{suggestions.map(s=><button type="button" key={s} disabled={busy} onClick={()=>void ask(s)}>{s}</button>)}</div>
        </div>}
        {messages.map((m,i)=>m.role==='user'
          ? <div className="ai-row ai-row-user" key={i}><p className="ai-bubble">{m.content}</p></div>
          : <div className="ai-row ai-row-assistant" key={i}><span className="ai-avatar ai-avatar-small"><TeravaMark size={18}/></span><div className="ai-answer"><p>{m.content}</p>{m.action && <div className="ai-action-card"><strong>{m.action.summary_vi}</strong><div><button type="button" disabled={busy} onClick={()=>void decide(m.action!.id,true)}>Xác nhận</button><button type="button" disabled={busy} onClick={()=>void decide(m.action!.id,false)}>Huỷ</button></div></div>}
              {!!m.sources?.length && <div className="ai-sources">{m.sources.map(s=><Link className="ai-source" href={`/properties/${s.id}`} key={s.id}><strong>{s.name}</strong><span>{s.code} · {s.price===null ? 'Giá chưa công bố':`${new Intl.NumberFormat('vi-VN').format(s.price)} VND${s.price_period==='Month' ? '/tháng':''}`}</span><em className={`ai-status ai-status-${s.availability}`}>{s.transaction_type==='Rent'&&s.availability==='Available' ? 'Còn cho thuê':availabilityLabels[s.availability]}</em><small>Cập nhật {new Date(s.updated_at).toLocaleString('vi-VN')}</small></Link>)}</div>}
            </div></div>)}
        {busy && voice!=='thinking' && <div className="ai-row ai-row-assistant"><span className="ai-avatar ai-avatar-small"><TeravaMark size={18}/></span><span className="ai-typing" role="status" aria-label="Trợ lý đang soạn câu trả lời…"><i/><i/><i/></span></div>}
        {notice && <p className="ai-notice" role="status">{notice}</p>}
      </div>

      {error && <div className="ai-error" role="alert"><p>{error}</p><Link href="/customer/inquiries/new">Gửi biểu mẫu tư vấn</Link></div>}

      {messages.filter(m=>m.action && (!m.action.status||m.action.status==='Pending') && (m.action.tool==='request_handoff'||m.action.tool==='propose_appointment')).map(m=>{const action=m.action!;const chosen=consents[action.id]||{Call:false,AIVoice:false};return <div className="ai-action-consent" key={`consent-${action.id}`}><p>Contact consent</p><label><input type="checkbox" checked={chosen.Call} onChange={e=>setConsents(c=>({...c,[action.id]:{...chosen,Call:e.target.checked}}))}/> Call</label><label><input type="checkbox" checked={chosen.AIVoice} onChange={e=>setConsents(c=>({...c,[action.id]:{...chosen,AIVoice:e.target.checked}}))}/> AI voice</label></div>})}
      {voice ? <div className="ai-voice" data-state={voice}>
        <button type="button" className="ai-orb" onClick={()=>{if(voice==='idle')voiceTurn();}} aria-label={voiceLabels[voice]}><span/><span/><span/></button>
        <strong role="status" aria-live="polite">{voiceLabels[voice]}</strong>
        <p className="ai-heard">{heard || (voice==='speaking' ? 'Bạn có thể nói chen để ngắt lời.':' ')}</p>
        <button type="button" className="ai-voice-end" onClick={stopVoice}><X size={16}/> Kết thúc trò chuyện bằng giọng nói</button>
      </div>
      : <form className="ai-composer" onSubmit={e=>{e.preventDefault();void send();}}>
        <label htmlFor="ai-message" className="sr-only">Nhập câu hỏi cho trợ lý AI</label>
        <textarea id="ai-message" ref={input} value={text} rows={1} maxLength={2000} disabled={busy} placeholder={dictating ? 'Đang nghe… hãy nói câu hỏi của bạn':'Hỏi về căn hộ, giá, khu vực…'}
          onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/>
        <div className="ai-composer-bar">
          <label className="ai-switch" title={session ? 'Lựa chọn áp dụng cho cả cuộc trò chuyện':'Lưu lại nội dung để chuyên viên xem'}>
            <input type="checkbox" role="switch" checked={store} disabled={!!session || busy} onChange={e=>setStore(e.target.checked)}/><span/>Lưu lịch sử
          </label>
          <div className="ai-composer-actions">
            {speechSupported && <button type="button" className={`ai-icon${dictating ? ' ai-recording':''}`} onClick={toggleDictation} disabled={busy} title={dictating ? 'Dừng ghi':'Nói thay vì gõ'} aria-label={dictating ? 'Dừng ghi':'Nói thay vì gõ'}>{dictating ? <MicOff size={18}/>:<Mic size={18}/>}</button>}
            <button type="button" className="ai-icon" onClick={startVoice} disabled={busy || dictating} title="Trò chuyện bằng giọng nói" aria-label="Trò chuyện bằng giọng nói"><AudioLines size={18}/></button>
            <button type="submit" className="ai-send" disabled={busy || dictating || !text.trim()} aria-label="Gửi"><ArrowUp size={18}/></button>
          </div>
        </div>
      </form>}

      <footer className="ai-panel-foot">
        {handoffOpen && signedIn ? <div className="ai-handoff">
          <label htmlFor="ai-time">Giờ mong muốn (không bắt buộc)</label>
          <input id="ai-time" type="datetime-local" value={preferred} onChange={e=>{setPreferred(e.target.value);setHandoffKey(undefined);}}/>
          <div><button type="button" className="ai-link" onClick={()=>setHandoffOpen(false)}>Huỷ</button><button type="button" className="ai-handoff-send" onClick={()=>void handoff()} disabled={!session || busy}>Gửi yêu cầu</button></div>
          <small>Thời gian chỉ là đề nghị, chuyên viên sẽ liên hệ xác nhận.</small>
        </div>
        : <>
          <small>Trợ lý AI có thể chưa chính xác. Hãy kiểm tra lại với chuyên viên.</small>
          {signedIn ? <button type="button" className="ai-link" disabled={!session || !!notice} onClick={()=>setHandoffOpen(true)}><UserRound size={14}/> Gặp chuyên viên</button>
            : <Link className="ai-link" href="/sign-in"><UserRound size={14}/> Đăng nhập để gặp chuyên viên</Link>}
        </>}
      </footer>
    </section>}
    {!open && <button ref={launcher} type="button" className="ai-launcher" aria-label="Trò chuyện với trợ lý AI" aria-controls="ai-chat-panel" aria-expanded={open} onClick={()=>{setOpen(true);requestAnimationFrame(()=>input.current?.focus());}}>
      <span className="ai-avatar"><TeravaMark size={24}/></span><span>Hỏi trợ lý AI</span>
    </button>}
  </aside>;
}
