'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUp, AudioLines, ChevronLeft, ChevronRight, Maximize2, Menu, Mic, MicOff, Minimize2, Plus, Search, UserRound, X } from 'lucide-react';
import { TeravaMark } from './brand';
import { availabilityLabels } from '@/lib/catalog';
import { chatStorageKey } from '@/lib/chat-storage';
import { RecommendationCard } from './recommendation-card';
import { BookingForm, type BookingProperty } from './booking-form';
import { useFavoriteStatus } from './property-card';

type Source={id:string;code:string;name:string;updated_at:string;price:number|null;availability:keyof typeof availabilityLabels;transaction_type:'Sale'|'Rent';price_period:'Total'|'Month';number?:number;cover_id?:string|null;area?:number|null;bedrooms?:number|null;location?:string;reason?:string;relaxed_reason?:string};
type PendingAction={id:string;tool:string;summary_vi:string;status?:string;requires_verified_phone?:boolean};
type BookingAction={type:'booking_form';property:BookingProperty;requires_sign_in?:boolean};
type Message={role:'user'|'assistant';content:string;sources?:Source[];related?:Source[];action?:PendingAction;booking?:BookingAction;options?:string[]};
type HistoryItem={id:string;title:string;time:string;updated_at?:string;message_count?:number;messages?:Message[]};
type ConversationState={messages:Message[];sessionId?:string;pending:boolean;controller?:AbortController;error:string;store:boolean;unread:boolean;};
const historyCollapsedKey='terava-chat-history-collapsed-v1';
function validMessage(message:Message){
  return message && (message.role==='user'||message.role==='assistant') && typeof message.content==='string' && (!message.options || Array.isArray(message.options) && message.options.length<=3 && message.options.every(option=>typeof option==='string')) &&
    (!message.sources || Array.isArray(message.sources) && message.sources.every(source=>source && typeof source.id==='string' && typeof source.name==='string' && typeof source.code==='string' && typeof source.updated_at==='string' && (source.price===null || typeof source.price==='number') && Object.hasOwn(availabilityLabels,source.availability))) && (!message.related || Array.isArray(message.related)) && (!message.action || typeof message.action.id==='string' && typeof message.action.summary_vi==='string');
}
type VoiceState='idle'|'listening'|'thinking'|'speaking';
type Recognition={lang:string;interimResults:boolean;continuous:boolean;start():void;stop():void;abort():void;
  onresult:((event:{resultIndex:number;results:ArrayLike<{isFinal:boolean;0:{transcript:string}}>})=>void)|null;onend:(()=>void)|null;onerror:((event:{error:string})=>void)|null};
type RecognitionCtor=new()=>Recognition;

const suggestions=['Căn hộ dưới 3,5 tỷ ở Thủ Đức','Cho thuê căn hộ 2 phòng ngủ Quận 7','Tư vấn đất nền TP.HCM'];
const returnPathStorageKey='terava-chat-return-path-v1';
const localHistoryKey='terava-chat-history-v1';
const voiceLabels:Record<VoiceState,string>={idle:'Chạm để nói',listening:'Đang nghe…',thinking:'Đang suy nghĩ…',speaking:'Đang trả lời…'};
const normalize=(value:string)=>value.toLocaleLowerCase('vi').replace(/[^\p{L}\p{N} ]/gu,'').replace(/\s+/g,' ').trim();
const historyTimestamp=(item:HistoryItem)=>new Date(item.updated_at||item.time||0).getTime();
function mergeHistory(...lists:HistoryItem[][]){
  const merged=new Map<string,HistoryItem>();
  for(const list of lists)for(const item of list){
    if(!item?.id)continue;
    const previous=merged.get(item.id);
    merged.set(item.id,previous ? {...previous,...item,messages:item.messages?.length?item.messages:previous.messages} : item);
  }
  return [...merged.values()].sort((a,b)=>historyTimestamp(b)-historyTimestamp(a)||b.id.localeCompare(a.id));
}
function historyBucket(item:HistoryItem){
  const age=Date.now()-historyTimestamp(item),day=86400000;
  return age<day?'Hôm nay':age<7*day?'7 ngày qua':'Cũ hơn';
}
const maskTitle=(value:string)=>value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email đã ẩn]').replace(/(?:\+?84|0)[35789](?:[ .()-]?\d){8}/g,'[đã ẩn số liên hệ]').replace(/\s+/g,' ').trim().slice(0,80);

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
  const router=useRouter();
  const fullPage=visible && navigationKey.split('?')[0]==='/tro-ly-ai';
  const [open,setOpen]=useState(false),[store,setStore]=useState(false),[session,setSession]=useState<string>();
  const [messages,setMessages]=useState<Message[]>([]),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [historyItems,setHistoryItems]=useState<HistoryItem[]>([]),[historyOpen,setHistoryOpen]=useState(false),[historyCollapsed,setHistoryCollapsed]=useState(false),[historySearch,setHistorySearch]=useState(''),[citation,setCitation]=useState<number>(),[conversationVersion,setConversationVersion]=useState(0),[confirmDelete,setConfirmDelete]=useState<string>();
  const [dictating,setDictating]=useState(false),[voice,setVoice]=useState<VoiceState|null>(null),[heard,setHeard]=useState(''),[showLatest,setShowLatest]=useState(false);
  const [handoffOpen,setHandoffOpen]=useState(false),[preferred,setPreferred]=useState(''),[handoffKey,setHandoffKey]=useState<string>(),[notice,setNotice]=useState(''),[bookingProperty,setBookingProperty]=useState<BookingProperty>();
  const [consents,setConsents]=useState<Record<string,{Call:boolean;AIVoice:boolean}>>({}),[deciding,setDeciding]=useState<string>();
  void deciding;
  // Speech support is a browser capability: false during server rendering, real value after hydration.
  const speechSupported=useSyncExternalStore(subscribeNever,()=>!!recognitionCtor(),()=>false);
  const pending=useRef(false),recognition=useRef<Recognition|null>(null),voiceOn=useRef(false),log=useRef<HTMLDivElement>(null),input=useRef<HTMLTextAreaElement>(null),atBottom=useRef(true);
  const history=useRef<Message[]>([]),sessionRef=useRef<string|undefined>(undefined);
  const panel=useRef<HTMLElement>(null),launcher=useRef<HTMLButtonElement>(null),finishSpeech=useRef<(()=>void)|null>(null),voiceEpoch=useRef(0),historySessionRef=useRef<string|undefined>(undefined);
  const conversations=useRef(new Map<string,ConversationState>()),activeConversation=useRef<string|undefined>(undefined);
  const requestController=useRef<AbortController|null>(null),conversationEpoch=useRef(0);
  const voiceActive=voice!==null;
  const [restored,setRestored]=useState(false);
  const favoriteIds=useMemo(()=>Array.from(new Set(messages.flatMap(message=>[...(message.sources||[]),...(message.related||[])].map(source=>source.id)))),[messages]);
  const favorites=useFavoriteStatus(favoriteIds,signedIn);
  const refreshConversations=useCallback(()=>setConversationVersion(value=>value+1),[]);
  useEffect(()=>{
    try{
      const saved=JSON.parse(window.sessionStorage.getItem(chatStorageKey)||'null');
      if(saved?.ownerKey===ownerKey && Array.isArray(saved.messages) && saved.messages.slice(-30).every(validMessage)){
        const restoredMessages=saved.messages.slice(-30);
        const restoredSession=typeof saved.session_id==='string' ? saved.session_id:crypto.randomUUID();
        history.current=restoredMessages;sessionRef.current=typeof saved.session_id==='string' ? saved.session_id:undefined;historySessionRef.current=restoredSession;activeConversation.current=restoredSession;
        conversations.current.set(restoredSession,{messages:restoredMessages,sessionId:sessionRef.current,pending:false,error:'',store:saved.store===true,unread:false});
        // Restore browser-only storage after hydration.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMessages(restoredMessages);setSession(sessionRef.current);setStore(saved.store===true);setOpen(saved.open===true);setText(typeof saved.draft==='string' ? saved.draft.slice(0,2000):'');
      }else window.sessionStorage.removeItem(chatStorageKey);
    }catch{}
    setRestored(true);
  },[ownerKey]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{try{setHistoryCollapsed(window.localStorage.getItem(historyCollapsedKey)==='1');}catch{}},[]);
  useEffect(()=>{try{window.localStorage.setItem(historyCollapsedKey,historyCollapsed?'1':'0');}catch{}},[historyCollapsed]);
  useEffect(()=>{
    if(!fullPage)return;
    let cancelled=false;
    const load=async()=>{
      let serverItems:HistoryItem[]=[];
      if(signedIn){
        try{const response=await fetch('/api/ai/sessions?page=1');if(response.ok){const result=await response.json();serverItems=(result.items||[]).map((item:HistoryItem)=>({...item,time:item.updated_at||item.time}));}}catch{}
      }
      try{const saved=JSON.parse(window.localStorage.getItem(localHistoryKey)||'[]');if(Array.isArray(saved)){const localItems=saved.slice(0,20).map((item:HistoryItem)=>({...item,title:maskTitle(item.title)}));serverItems=mergeHistory(serverItems,localItems);}}catch{}
      if(!cancelled)setHistoryItems(mergeHistory(serverItems));
    };
    void load();return()=>{cancelled=true;};
  },[fullPage,signedIn,session]);
  useEffect(()=>{
    if(!fullPage||!messages.length||!session)return;
    const first=messages.find(message=>message.role==='user');if(!first)return;
    const item:HistoryItem={id:activeConversation.current||session,title:maskTitle(first.content),time:new Date().toISOString(),message_count:messages.length,messages};
    try{const current=JSON.parse(window.localStorage.getItem(localHistoryKey)||'[]');const next=mergeHistory([item],Array.isArray(current)?current:[]).slice(0,20);window.localStorage.setItem(localHistoryKey,JSON.stringify(next));window.setTimeout(()=>setHistoryItems(existing=>mergeHistory([item],existing).slice(0,20)),0);}catch{}
  },[fullPage,messages,session]);
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

  useEffect(()=>{history.current=messages;sessionRef.current=session;if(activeConversation.current){const current=conversations.current.get(activeConversation.current);if(current)current.messages=messages;}},[messages,session]);
  useEffect(()=>{if(open){if(voiceActive)panel.current?.querySelector<HTMLButtonElement>('.ai-voice-end')?.focus();else input.current?.focus();}},[open,voiceActive]);
  // The route is an external navigation state; opening the existing panel keeps its state intact.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{if(fullPage)setOpen(true);},[fullPage]);
  useEffect(()=>{
    const element=log.current;if(!element)return;
    if(atBottom.current){element.scrollTo({top:element.scrollHeight,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant':'smooth'});setShowLatest(false);}
    else if(messages.length)window.setTimeout(()=>setShowLatest(true),0);
  },[messages,busy,heard]);
  useEffect(()=>{const el=input.current;if(el){el.style.height='auto';el.style.height=`${Math.min(el.scrollHeight,160)}px`;}},[text]);
  useEffect(()=>()=>{voiceOn.current=false;voiceEpoch.current++;if(recognition.current){recognition.current.onend=null;recognition.current.onresult=null;recognition.current.onerror=null;recognition.current.abort();}window.speechSynthesis?.cancel();finishSpeech.current?.();},[]);

  const persistLocalHistory=useCallback((key:string,items:Message[])=>{
    const first=items.find(message=>message.role==='user');if(!first)return;
    const item:HistoryItem={id:key,title:maskTitle(first.content),time:new Date().toISOString(),message_count:items.length,messages:items};
    try{const current=JSON.parse(window.localStorage.getItem(localHistoryKey)||'[]');const next=mergeHistory([item],Array.isArray(current)?current:[]).slice(0,20);window.localStorage.setItem(localHistoryKey,JSON.stringify(next));setHistoryItems(existing=>mergeHistory([item],existing).slice(0,20));}catch{}
  },[]);
  const ask=useCallback(async(message:string)=>{
    const content=message.trim();if(!content)return null;
    const key=historySessionRef.current||sessionRef.current||crypto.randomUUID();historySessionRef.current=key;activeConversation.current=key;
    let state=conversations.current.get(key);if(!state){state={messages:[],sessionId:sessionRef.current,pending:false,error:'',store,unread:false};conversations.current.set(key,state);}
    if(activeConversation.current===key&&history.current.length>state.messages.length)state.messages=history.current;
    if(state.pending)return null;
    if([...conversations.current.values()].filter(item=>item.pending).length>=2){const limit='Đang có 2 câu trả lời đang chạy, vui lòng chờ.';state.error=limit;setError(limit);return null;}
    if(content.length>2000){setError('Tin nhắn tối đa 2.000 ký tự.');return null;}
    const requestSession=state.sessionId;
    const controller=new AbortController();state.controller=controller;requestController.current=controller;state.pending=true;state.error='';state.store=store;
    state.messages=[...state.messages,{role:'user',content}];pending.current=true;setBusy(true);setError('');setMessages(state.messages);refreshConversations();persistLocalHistory(key,state.messages);setHistoryItems(existing=>mergeHistory([{id:key,title:maskTitle(content),time:new Date().toISOString(),message_count:state.messages.length,messages:state.messages}],existing));
    try{
      const requestHistory=state.messages.slice(0,-1).slice(-10).map(({role,content,sources})=>({role,content:role==='assistant'&&sources?.length?`${content}\nM\u00e3: ${sources.map(source=>source.code).join(', ')}`.slice(0,8000):content}));
      const response=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream'},signal:controller.signal,body:JSON.stringify({session_id:requestSession,message:content,history:requestHistory,store_transcript:store,property_id:propertyId || null})});

      if(!response.ok)throw new Error((await response.json()).message);
      if(!response.headers.get('content-type')?.includes('text/event-stream')){const result=await response.json();state.sessionId=result.session.id;state.messages=[...state.messages,{role:'assistant',content:result.reply,sources:result.sources,related:result.related,action:result.action?.tool?result.action:undefined,booking:result.action?.type==='booking_form'?result.action:undefined,options:result.clarify?.needed?result.clarify.options:undefined}];if(result.action?.type==='booking_form'&&activeConversation.current===key)setBookingProperty(result.action.property);if(activeConversation.current===key)setMessages(state.messages);return result.reply as string;}
      const reader=response.body?.getReader();if(!reader)throw new Error('Không nhận được nội dung trả lời.');let buffer='',reply='',sources:Source[]=[],related:Source[]=[],action:PendingAction|undefined,booking:BookingAction|undefined;state.messages=[...state.messages,{role:'assistant',content:''}];
      const update=()=>{const last=state.messages.length-1;if(last>=0&&state.messages[last].role==='assistant')state.messages[last]={role:'assistant',content:reply,sources,related,action,booking};if(activeConversation.current===key)setMessages(state.messages);};
      while(true){const chunk=await reader.read();buffer+=new TextDecoder().decode(chunk.value||new Uint8Array(),{stream:!chunk.done});let end;while((end=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const lines=block.split('\n'),line=lines.find(value=>value.startsWith('data:'));if(!line)continue;/* The SSE event name is on its own `event:` line; `type` inside data is optional. */const event={type:lines.find(value=>value.startsWith('event:'))?.slice(6).trim(),...JSON.parse(line.slice(5))};if(event.related)related=event.related;if(event.type==='meta'){state.sessionId=event.session_id;if(activeConversation.current===key){sessionRef.current=state.sessionId;setSession(state.sessionId);}sources=event.sources||[];}else if(event.type==='delta')reply+=event.text||'';else if(event.type==='action'){if(event.action?.type==='booking_form'){booking=event.action;setBookingProperty(event.action.property);}else action=event.action;}else if(event.type==='done')reply=event.message||reply;update();}if(chunk.done)break;}
      return reply;
    }catch(e){
      if(controller.signal.aborted)return null;
      state.messages=state.messages.slice(0,-1);if(activeConversation.current===key){setMessages(state.messages);setText(content);setError(e instanceof Error ? e.message:'Chưa thể gửi tin nhắn.');}else state.error=e instanceof Error ? e.message:'Chưa thể gửi tin nhắn.';return null;
    }finally{state.controller=undefined;state.pending=false;state.unread=activeConversation.current!==key;refreshConversations();if(!state.store)persistLocalHistory(key,state.messages);if(activeConversation.current===key){pending.current=false;setBusy(false);setMessages(state.messages);}else setHistoryItems(existing=>existing.map(item=>item.id===key?{...item,messages:state.messages,message_count:state.messages.length}:item));}
  },[propertyId,store,persistLocalHistory,refreshConversations]);

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
  function openFullPage(){
    try{if(!fullPage)window.sessionStorage.setItem(returnPathStorageKey,navigationKey || '/properties');}catch{}
    setOpen(true);router.push('/tro-ly-ai');
  }
  function minimize(){
    stopVoice();
    let returnPath='/properties';
    try{
      const saved=window.sessionStorage.getItem(returnPathStorageKey);
      if(saved?.startsWith('/')&&!saved.startsWith('//')&&!saved.startsWith('/tro-ly-ai'))returnPath=saved;
      window.sessionStorage.removeItem(returnPathStorageKey);
    }catch{}
    router.push(returnPath);
  }
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
  function cancelPending(){
    if(!pending.current)return;
    conversationEpoch.current++;const active=activeConversation.current?conversations.current.get(activeConversation.current):undefined;active?.controller?.abort();if(active)active.controller=undefined;requestController.current=null;
    const stopped=[...history.current];
    const last=stopped.at(-1);
    if(stopped.length&&(last?.role==='user'||last?.role==='assistant'&&last.content==='')){
      const messagesWithStop=last.role==='assistant' ? [...stopped.slice(0,-1),{role:'assistant' as const,content:'Đã dừng'}] : [...stopped,{role:'assistant' as const,content:'Đã dừng'}];
      const stoppedSession=historySessionRef.current||sessionRef.current;
      if(stoppedSession){const first=messagesWithStop.find(message=>message.role==='user');if(first){const item:HistoryItem={id:stoppedSession,title:maskTitle(first.content),time:new Date().toISOString(),message_count:messagesWithStop.length,messages:messagesWithStop};try{const current=JSON.parse(window.localStorage.getItem(localHistoryKey)||'[]');const next=mergeHistory([item],Array.isArray(current)?current:[]).slice(0,20);window.localStorage.setItem(localHistoryKey,JSON.stringify(next));setHistoryItems(next);}catch{}}}
      setMessages(messagesWithStop);
    }
    pending.current=false;setBusy(false);
  }
  function reset(){try{window.sessionStorage.removeItem(chatStorageKey);}catch{}stopVoice();setPreferred('');setBookingProperty(undefined);const key=crypto.randomUUID();activeConversation.current=key;historySessionRef.current=key;sessionRef.current=undefined;setSession(undefined);setMessages([]);setStore(false);setNotice('');setHandoffKey(undefined);setError('');setText('');setHandoffOpen(false);pending.current=false;setBusy(false);}
  async function loadHistory(item:HistoryItem){
    activeConversation.current=item.id;historySessionRef.current=item.id;
    const running=conversations.current.get(item.id);if(running){sessionRef.current=running.sessionId||item.id;setSession(sessionRef.current);setMessages(running.messages);setStore(running.store);setBusy(running.pending);pending.current=running.pending;setError(running.error);setHistoryOpen(false);running.unread=false;refreshConversations();return;}
    try{const response=await fetch(`/api/ai/sessions/${item.id}`);if(!response.ok)throw new Error('Không thể tải lịch sử.');const result=await response.json();const loaded=(result.session?.messages||[]).filter(validMessage);sessionRef.current=item.id;setSession(item.id);setMessages(loaded);setStore(true);conversations.current.set(item.id,{messages:loaded,sessionId:item.id,pending:false,error:'',store:true,unread:false});setHistoryOpen(false);setError('');}
    catch(error){if(item.messages?.length){sessionRef.current=item.id;setSession(item.id);setMessages(item.messages);setStore(false);setHistoryOpen(false);return;}setError(error instanceof Error?error.message:'Không thể tải lịch sử.');}
  }
  function deleteLocalHistory(id:string){try{const current=JSON.parse(window.localStorage.getItem(localHistoryKey)||'[]');const next=Array.isArray(current)?current.filter((item:HistoryItem)=>item.id!==id):[];window.localStorage.setItem(localHistoryKey,JSON.stringify(next));setHistoryItems(next);}catch{}}
  function openBooking(source:Source){setBookingProperty(source);setError('');}
  async function deleteConversation(item:HistoryItem){const running=conversations.current.get(item.id);running?.controller?.abort();if(signedIn&&!item.messages){try{const response=await fetch(`/api/ai/sessions/${item.id}`,{method:'DELETE'});if(!response.ok)throw new Error('Không thể xoá cuộc trò chuyện.');}catch(e){setError(e instanceof Error?e.message:'Không thể xoá cuộc trò chuyện.');return;}}deleteLocalHistory(item.id);conversations.current.delete(item.id);setConfirmDelete(undefined);if(activeConversation.current===item.id||session===item.id)reset();setHistoryItems(existing=>existing.filter(entry=>entry.id!==item.id));}
  function cite(number:number){setCitation(number);const target=panel.current?.querySelector<HTMLElement>(`[data-source-number="${number}"]`);target?.scrollIntoView({behavior:'smooth',block:'center'});window.setTimeout(()=>setCitation(undefined),1800);}
  function renderInline(content:string):ReactNode[]{
    const tokens=content.split(/(\[\d{1,3}\]|\*\*[^*\n]+\*\*|__[^_\n]+__|(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_))/g);
    return tokens.filter(Boolean).map((part,index)=>{
      if(/^\[\d{1,3}\]$/.test(part))return <button type="button" key={index} className="ai-citation-chip" onClick={()=>cite(Number(part.slice(1,-1)))}>{part}</button>;
      if((part.startsWith('**')&&part.endsWith('**'))||(part.startsWith('__')&&part.endsWith('__')))return <strong key={index}>{part.slice(2,-2)}</strong>;
      if((part.startsWith('*')&&part.endsWith('*'))||(part.startsWith('_')&&part.endsWith('_')))return <em key={index}>{part.slice(1,-1)}</em>;
      return <span key={index}>{part}</span>;
    });
  }
  function renderReply(content:string){
    const lines=content.split(/\r?\n/);const nodes:ReactNode[]=[];let index=0;
    while(index<lines.length){
      const match=lines[index].match(/^\s*[-*]\s+(.+)$/);const ordered=lines[index].match(/^\s*\d+[.)]\s+(.+)$/);
      if(match||ordered){const items:ReactNode[]=[];const isOrdered=!!ordered;while(index<lines.length){const current=lines[index].match(isOrdered?/^\s*\d+[.)]\s+(.+)$/:/^\s*[-*]\s+(.+)$/);if(!current)break;items.push(<li key={index}>{renderInline(current[1])}</li>);index++;}const List=isOrdered?'ol':'ul';nodes.push(<List key={`list-${index}`}>{items}</List>);if(index<lines.length)nodes.push(<br key={`break-${index}`}/>);continue;}
      if(lines[index])nodes.push(<span key={`line-${index}`}>{renderInline(lines[index])}</span>);
      if(index<lines.length-1)nodes.push(<br key={`line-break-${index}`}/>);index++;
    }
    return nodes;
  }
  function scrollToLatest(){const element=log.current;if(!element)return;atBottom.current=true;element.scrollTo({top:element.scrollHeight,behavior:'smooth'});setShowLatest(false);}

  if(!visible || !restored)return null;
  const pageSuggestions=fullPage?['Thuê chung cư Thủ Đức','Mua căn hộ Quận 7','Thuê nhà phố Bình Thạnh','Mua nhà phố Quận 10']:suggestions;
  void conversationVersion;
  const liveHistory=[...conversations.current.entries()].filter(([,state])=>state.pending||state.unread).map(([id,state]):HistoryItem=>({id,title:maskTitle(state.messages.find(message=>message.role==='user')?.content||'Cuộc trò chuyện mới'),time:new Date().toISOString(),message_count:state.messages.length,messages:state.messages}));
  const filteredHistory=mergeHistory(historyItems,liveHistory).filter(item=>!historySearch||item.title.toLocaleLowerCase().includes(historySearch.toLocaleLowerCase()));
  const historyGroups=['Hôm nay','7 ngày qua','Cũ hơn'].map(label=>({label,items:filteredHistory.filter(item=>historyBucket(item)===label)})).filter(group=>group.items.length);
  void historyGroups;
  return <aside className={`ai-chat${fullPage?' ai-chat-full':''}`}>
    {fullPage && <div className="ai-history-summary" aria-live="polite"><strong>{historyItems.length} cuộc trò chuyện</strong><small>{signedIn&&store?'Đã lưu vào tài khoản':'Lưu trên thiết bị này'} · Tối đa 20 cuộc, cũ nhất sẽ được loại bỏ.</small></div>}
    {open && <section ref={panel} id="ai-chat-panel" className="ai-panel" role="dialog" aria-label="Trợ lý AI TERAVA" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const nodes=panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],textarea:not(:disabled),input:not(:disabled)');if(nodes?.length){const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}}}>
      {fullPage && <aside className={`ai-history${historyOpen?' is-open':''}${historyCollapsed?' is-collapsed':''}`} aria-label="Lịch sử trò chuyện">
        <span className="sr-only">Hôm nay · 7 ngày qua · Cũ hơn</span><div className="ai-history-head"><strong>Lịch sử</strong><button type="button" className="ai-icon" onClick={()=>setHistoryCollapsed(value=>!value)} aria-label={historyCollapsed?'Mở thanh lịch sử':'Thu gọn thanh lịch sử'}>{historyCollapsed?<ChevronRight size={18}/>:<ChevronLeft size={18}/>}</button></div>
         {!historyCollapsed && <><button type="button" className="ai-history-new" onClick={()=>{reset();setHistoryOpen(false);}}><Plus size={16}/> Cuộc trò chuyện mới</button><label className="ai-history-search"><Search size={15}/><input value={historySearch} onChange={event=>setHistorySearch(event.target.value)} placeholder="Tìm trong lịch sử" aria-label="Tìm trong lịch sử"/></label><div className="ai-history-list">{filteredHistory.length?filteredHistory.map(item=>{const state=conversations.current.get(item.id);return <div className={`ai-history-item${item.id===session?' is-active':''}`} key={item.id}><button type="button" onClick={()=>void loadHistory(item)}><strong>{item.title}</strong><small>{state?.pending?'Đang trả lời…':state?.unread?'Câu trả lời mới':item.time?new Date(item.time).toLocaleString('vi-VN'):'Mới'}{item.message_count?` · ${item.message_count} tin nhắn`:''}</small></button>{!signedIn&&<button type="button" className="ai-history-delete" onClick={()=>deleteLocalHistory(item.id)} aria-label={`Xoá ${item.title}`}><X size={14}/></button>}</div>}):<p className="ai-history-empty">Chưa có cuộc trò chuyện nào.</p>}</div><div className="ai-history-foot"><Link href="/properties">Về trang bất động sản</Link><small>{signedIn&&store?'Lưu lịch sử đang bật':'Lịch sử chỉ lưu trên thiết bị này'}</small></div></>}
      </aside>}
      {fullPage && <div className="ai-history-delete-tools" aria-label="Xoá cuộc trò chuyện">{historyItems.map(item=><div key={`delete-${item.id}`}>{confirmDelete===item.id?<span>Xoá cuộc trò chuyện này? <button type="button" onClick={()=>void deleteConversation(item)}>Xoá</button><button type="button" onClick={()=>setConfirmDelete(undefined)}>Huỷ</button></span>:<button type="button" className="ai-history-delete" aria-label="Xoá cuộc trò chuyện" onClick={()=>setConfirmDelete(item.id)}><X size={14}/></button>}</div>)}</div>}
      <header className="ai-panel-head">
        {fullPage && <button type="button" className="ai-history-mobile" onClick={()=>setHistoryOpen(true)}><Menu size={17}/> Lịch sử</button>}
        {!fullPage ? <button type="button" className="ai-title" onClick={openFullPage} title="Mở toàn màn hình" aria-label="Mở toàn màn hình">
          <span className="ai-avatar"><TeravaMark size={26}/></span><span className="ai-title-copy"><h2>Trợ lý TERAVA</h2><small>Trợ lý AI · tư vấn bất động sản</small>{propertyName && <small>Đang xem: {propertyName}</small>}</span>
        </button> : <><span className="ai-avatar"><TeravaMark size={26}/></span><span className="ai-title-copy"><h2>Trợ lý TERAVA</h2><small>Trợ lý AI · tư vấn bất động sản</small>{propertyName && <small>Đang xem: {propertyName}</small>}</span></>}
        {!fullPage && <button type="button" className="ai-icon" onClick={openFullPage} title="Mở toàn màn hình" aria-label="Mở toàn màn hình"><Maximize2 size={18}/></button>}
         <button type="button" className="ai-icon" onClick={()=>{reset();requestAnimationFrame(()=>input.current?.focus());}} title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới"><Plus size={18}/></button>
        {fullPage ? <button type="button" className="ai-icon" onClick={minimize} title="Thu nhỏ" aria-label="Thu nhỏ"><Minimize2 size={18}/></button>
          : <button type="button" className="ai-icon" onClick={close} title="Đóng" aria-label="Đóng"><X size={18}/></button>}
      </header>

      <div className="ai-log" ref={log} onScroll={event=>{const element=event.currentTarget;const next=element.scrollTop+element.clientHeight>=element.scrollHeight-24;atBottom.current=next;if(next)setShowLatest(false);}} role="log" aria-live="polite" aria-relevant="additions">
        {bookingProperty && <BookingForm property={bookingProperty} signedIn={signedIn} sessionId={session} onClose={()=>setBookingProperty(undefined)} onSuccess={message=>{setMessages(current=>[...current,{role:'assistant',content:message}]);setBookingProperty(undefined);setNotice(message);}}/>}
        {!messages.length && <div className="ai-welcome">
          {fullPage && <div className="ai-suggestions ai-full-suggestions">{pageSuggestions.map(s=><button type="button" key={`full-${s}`} disabled={busy} onClick={()=>void ask(s)}>{s}</button>)}</div>}
          <span className="ai-welcome-mark"><TeravaMark size={44}/></span>
          <h3>Xin chào! Tôi có thể giúp gì cho bạn?</h3>
          <p>Tôi là trợ lý AI của TERAVA, trả lời dựa trên dữ liệu bất động sản đã công bố. Chuyên viên sẽ xác nhận mọi đề nghị.</p>
          <div className="ai-suggestions">{suggestions.map(s=><button type="button" key={s} disabled={busy} onClick={()=>void ask(s)}>{s}</button>)}</div>
        </div>}
        {messages.map((m,i)=>m.role==='user'
          ? <div className="ai-row ai-row-user" key={i}><p className="ai-bubble">{m.content}</p></div>
          : <div className="ai-row ai-row-assistant" key={i}><span className="ai-avatar ai-avatar-small"><TeravaMark size={18}/></span><div className="ai-answer"><div className="ai-answer-text">{renderReply(m.content)}</div>{m.action && <div className="ai-action-card"><strong>{m.action.summary_vi}</strong><div><button type="button" disabled={busy} onClick={()=>void decide(m.action!.id,true)}>Xác nhận</button><button type="button" disabled={busy} onClick={()=>void decide(m.action!.id,false)}>Huỷ</button></div></div>}
              {m.options?.length && <div className="ai-clarify-options" role="group" aria-label="Chọn khu vực">{m.options.map(option=><button type="button" key={option} disabled={busy} onClick={()=>void ask(option)}>{option}</button>)}</div>}
              {!!m.sources?.length && <div className="ai-sources">{m.sources.map(s=><Link className="ai-source" href={`/properties/${s.id}`} key={s.id}><strong>{s.name}</strong><span>{s.code} · {s.price===null ? 'Giá chưa công bố':`${new Intl.NumberFormat('vi-VN').format(s.price)} VND${s.price_period==='Month' ? '/tháng':''}`}</span><em className={`ai-status ai-status-${s.availability}`}>{s.transaction_type==='Rent'&&s.availability==='Available' ? 'Còn cho thuê':availabilityLabels[s.availability]}</em><small>Cập nhật {new Date(s.updated_at).toLocaleString('vi-VN')}</small></Link>)}</div>}
                {!!m.sources?.length && <div className="ai-property-list">{m.sources.slice(0,5).map(s=><div key={s.id} data-source-number={s.number} className={citation===s.number?'is-citation-target':''}><RecommendationCard source={s} related={false} onAsk={message=>message.startsWith('Đặt lịch')?openBooking(s):void ask(message)} signedIn={signedIn} saved={favorites.has(s.id)} customer={favorites.customer} ready={favorites.ready&&!favorites.error}/></div>)}</div>}
                {!!m.related?.length && <section className="ai-related"><h3>Có thể bạn quan tâm</h3><div className="ai-property-list">{m.related.slice(0,3).map(s=><RecommendationCard key={s.id} source={s} related onAsk={message=>void ask(message)} signedIn={signedIn} saved={favorites.has(s.id)} customer={favorites.customer} ready={favorites.ready&&!favorites.error}/>)}</div></section>}
             </div></div>)}
         {busy && voice!=='thinking' && <div className="ai-row ai-row-assistant"><span className="ai-avatar ai-avatar-small"><TeravaMark size={18}/></span><span className="ai-typing-bubble" role="status" aria-label="Trợ lý đang tìm dữ liệu…"><span>Trợ lý đang tìm dữ liệu…</span><span className="ai-typing"><i/><i/><i/></span><button type="button" className="ai-stop" onClick={cancelPending}>Dừng</button></span></div>}
         {notice && <p className="ai-notice" role="status">{notice}</p>}
        {showLatest && <button type="button" className="ai-latest" onClick={scrollToLatest}>Xuống tin mới nhất <ArrowUp size={15}/></button>}
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
