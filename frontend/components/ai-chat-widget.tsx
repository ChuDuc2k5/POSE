'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { TeravaMark } from './brand';
import { availabilityLabels, priceLabel } from '@/lib/catalog';
type Source={id:string;code:string;name:string;updated_at:string;price:number|null;availability:keyof typeof availabilityLabels};
type Message={role:'user'|'assistant';content:string;sources?:Source[]};
export function AiChatWidget({signedIn=false,propertyId}:{signedIn?:boolean;propertyId?:string}){
  const [open,setOpen]=useState(false),[store,setStore]=useState(false),[session,setSession]=useState<string>(),[messages,setMessages]=useState<Message[]>([]),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[preferred,setPreferred]=useState(''),[handoffKey,setHandoffKey]=useState<string>(),[notice,setNotice]=useState('');
  const pending=useRef(false),[composing,setComposing]=useState(false);
  async function send(){
    if(!text.trim() || pending.current)return;pending.current=true;setBusy(true);setComposing(true);setError('');
    try{
      const response=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:session,message:text,history:messages.slice(-10).map(({role,content})=>({role,content})),store_transcript:store,property_id:propertyId || null})});
      const result=await response.json();if(!response.ok)throw new Error(result.message);
      setSession(result.session.id);setMessages([...messages,{role:'user',content:text},{role:'assistant',content:result.reply,sources:result.sources}]);setText('');
    }catch(e){setError(e instanceof Error ? e.message:'Chưa thể gửi tin nhắn.');}finally{pending.current=false;setBusy(false);setComposing(false);}
  }
  async function handoff(){
    if(!session || pending.current)return;pending.current=true;setBusy(true);setError('');const key=handoffKey || crypto.randomUUID();setHandoffKey(key);
    try{
      const start=preferred ? new Date(preferred):null;
      const response=await fetch('/api/ai/handoff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:session,summary:'Khách yêu cầu chuyên viên tư vấn qua hội thoại TERAVA',request_key:key,preferred_start:start?.toISOString() || null,preferred_end:start ? new Date(start.getTime()+3600000).toISOString():null})});
      const result=await response.json();if(!response.ok)throw new Error(result.message);setNotice(result.message);
    }catch(e){setError(e instanceof Error ? e.message:'Chưa thể bàn giao.');}finally{pending.current=false;setBusy(false);}
  }
  return <aside className="ai-chat">
    <button className="button primary ai-chat-toggle" aria-expanded={open} aria-controls="ai-chat-panel" onClick={()=>setOpen(!open)}>{open ? 'Đóng hội thoại':'Trò chuyện với trợ lý AI'}</button>
    {open && <section id="ai-chat-panel" className="ai-chat-panel profile-panel" aria-label="Trợ lý AI TERAVA" aria-busy={busy}>
      <header className="ai-chat-heading"><TeravaMark size={36}/><div><span>TERAVA GROUP</span><h2>Trợ lý AI</h2></div></header>
      <p className="ai-disclosure">Tôi là trợ lý AI của TERAVA. Thông tin tham khảo dựa trên dữ liệu công bố; chuyên viên sẽ xác nhận đề nghị của bạn.</p>
      <label><input type="checkbox" checked={store} disabled={!!session || busy} onChange={e=>setStore(e.target.checked)}/> Lưu lịch sử hội thoại</label>
      <div className="ai-messages" role="log" aria-live="polite" aria-relevant="additions">
        {messages.map((m,i)=><article className={`ai-message ai-${m.role}`} key={i}><strong>{m.role==='user' ? 'Bạn':'TERAVA · trợ lý AI'}</strong><p>{m.content}</p>{m.sources?.map(s=><Link className="ai-source" href={`/properties/${s.id}`} key={s.id}><strong>{s.code} · {s.name}</strong><span>{priceLabel(s.price)} · {availabilityLabels[s.availability]}</span><small>Cập nhật lúc {new Date(s.updated_at).toLocaleString('vi-VN')}</small></Link>)}</article>)}
      </div>
      {composing && <p className="ai-pending" role="status">Trợ lý đang soạn câu trả lời…</p>}
      <form onSubmit={e=>{e.preventDefault();void send();}}><label htmlFor="ai-message">Nhu cầu của bạn</label><textarea id="ai-message" value={text} onChange={e=>setText(e.target.value)} maxLength={2000} rows={2} disabled={busy}/><button className="button primary" disabled={busy || !text.trim()}>Gửi</button></form>
      {error && <div role="alert"><p>{error}</p><button className="button secondary" disabled={busy || !text.trim()} onClick={()=>void send()}>Thử lại tin nhắn</button><Link href="/customer/inquiries/new">Gửi biểu mẫu tư vấn</Link></div>}
      {signedIn ? <div className="ai-handoff"><label htmlFor="ai-time">Giờ mong muốn (không bắt buộc, giờ địa phương)</label><input id="ai-time" type="datetime-local" value={preferred} disabled={!!notice} onChange={e=>{setPreferred(e.target.value);setHandoffKey(undefined);}}/><button className="button secondary" onClick={()=>void handoff()} disabled={!session || busy || !!notice}>Yêu cầu chuyên viên tư vấn</button><small>Thời gian chỉ là đề nghị, chưa xác nhận.</small></div>:<p><Link href="/sign-in">Đăng nhập</Link> hoặc <Link href="/customer/inquiries/new">gửi biểu mẫu tư vấn</Link> để chia sẻ thông tin liên hệ.</p>}
      {notice && <p role="status">{notice}</p>}
      <button className="button secondary" disabled={busy} onClick={()=>{setSession(undefined);setMessages([]);setStore(false);setNotice('');setHandoffKey(undefined);setError('');}}>Bắt đầu phiên mới</button>
    </section>}
  </aside>;
}
