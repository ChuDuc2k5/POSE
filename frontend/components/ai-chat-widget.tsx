'use client';
import { useState } from 'react';
import Link from 'next/link';
type Source={id:string;code:string;name:string;updated_at:string};
type Message={role:'user'|'assistant';content:string;sources?:Source[]};
export function AiChatWidget({signedIn=false,propertyId}:{signedIn?:boolean;propertyId?:string}){
  const [open,setOpen]=useState(false),[store,setStore]=useState(false),[session,setSession]=useState<string>(),[messages,setMessages]=useState<Message[]>([]),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[preferred,setPreferred]=useState(''),[handoffKey,setHandoffKey]=useState<string>(),[notice,setNotice]=useState('');
  async function send(){
    if(!text.trim() || busy)return;setBusy(true);setError('');
    try{
      const response=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:session,message:text,history:messages.slice(-10).map(({role,content})=>({role,content})),store_transcript:store,property_id:propertyId || null})});
      const result=await response.json();if(!response.ok)throw new Error(result.message);
      setSession(result.session.id);setMessages([...messages,{role:'user',content:text},{role:'assistant',content:result.reply,sources:result.sources}]);setText('');
    }catch(e){setError(e instanceof Error ? e.message:'Chưa thể gửi tin nhắn.');}finally{setBusy(false);}
  }
  async function handoff(){
    if(!session || busy)return;setBusy(true);setError('');const key=handoffKey || crypto.randomUUID();setHandoffKey(key);
    try{
      const start=preferred ? new Date(preferred):null;
      const response=await fetch('/api/ai/handoff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:session,summary:'Khách yêu cầu chuyên viên tư vấn qua hội thoại TERAVA',request_key:key,preferred_start:start?.toISOString() || null,preferred_end:start ? new Date(start.getTime()+3600000).toISOString():null})});
      const result=await response.json();if(!response.ok)throw new Error(result.message);setNotice(result.message);
    }catch(e){setError(e instanceof Error ? e.message:'Chưa thể bàn giao.');}finally{setBusy(false);}
  }
  return <aside className="ai-chat">
    <button className="button primary" aria-expanded={open} aria-controls="ai-chat-panel" onClick={()=>setOpen(!open)}>{open ? 'Đóng hội thoại':'Trò chuyện với trợ lý AI'}</button>
    {open && <section id="ai-chat-panel" className="ai-chat-panel" aria-label="Trợ lý AI TERAVA">
      <h2>Trợ lý AI TERAVA</h2><p>Tôi là trợ lý AI của TERAVA. Thông tin tham khảo dựa trên dữ liệu công bố; chuyên viên sẽ xác nhận đề nghị của bạn.</p>
      <label><input type="checkbox" checked={store} disabled={!!session || busy} onChange={e=>setStore(e.target.checked)}/> Lưu lịch sử hội thoại</label>
      <div className="ai-messages" role="log" aria-live="polite" aria-relevant="additions">
        {messages.map((m,i)=><article className={`ai-message ai-${m.role}`} key={i}><strong>{m.role==='user' ? 'Bạn':'TERAVA · trợ lý AI'}</strong><p>{m.content}</p>{m.sources?.map(s=><Link className="ai-source" href={`/properties/${s.id}`} key={s.id}>{s.code} · {s.name}<small>Cập nhật lúc {new Date(s.updated_at).toLocaleString('vi-VN')}</small></Link>)}</article>)}
      </div>
      <form onSubmit={e=>{e.preventDefault();void send();}}><label htmlFor="ai-message">Nhu cầu của bạn</label><textarea id="ai-message" value={text} onChange={e=>setText(e.target.value)} maxLength={2000} rows={2} disabled={busy}/><button className="button primary" disabled={busy || !text.trim()}>{busy ? 'Đang xử lý…':'Gửi'}</button></form>
      {error && <div role="alert"><p>{error}</p><button className="button secondary" disabled={busy || !text.trim()} onClick={()=>void send()}>Thử lại tin nhắn</button><Link href="/customer/inquiries/new">Gửi biểu mẫu tư vấn</Link></div>}
      {signedIn ? <div className="ai-handoff"><label htmlFor="ai-time">Giờ mong muốn (không bắt buộc, giờ địa phương)</label><input id="ai-time" type="datetime-local" value={preferred} disabled={!!notice} onChange={e=>{setPreferred(e.target.value);setHandoffKey(undefined);}}/><button className="button secondary" onClick={()=>void handoff()} disabled={!session || busy || !!notice}>Yêu cầu chuyên viên tư vấn</button><small>Thời gian chỉ là đề nghị, chưa xác nhận.</small></div>:<p><Link href="/sign-in">Đăng nhập</Link> hoặc <Link href="/customer/inquiries/new">gửi biểu mẫu tư vấn</Link> để chia sẻ thông tin liên hệ.</p>}
      {notice && <p role="status">{notice}</p>}
      <button className="button secondary" disabled={busy} onClick={()=>{setSession(undefined);setMessages([]);setStore(false);setNotice('');setHandoffKey(undefined);setError('');}}>Bắt đầu phiên mới</button>
    </section>}
  </aside>;
}
