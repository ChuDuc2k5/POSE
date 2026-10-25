'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { ArrowLeft, Bell, Check, RefreshCw } from 'lucide-react';
import { catalogRequest } from '@/lib/catalog-client';
import { inquiryLabels, type Inquiry } from '@/lib/discovery';

type Inbox={items:(Inquiry & {read_at:string|null})[];total:number;unread:number};
export function AdminInquiries(){
  const [data,setData]=useState<Inbox|null>(null),[page,setPage]=useState(1),[filter,setFilter]=useState('all'),[revision,setRevision]=useState(0);
  const [error,setError]=useState(''),[busy,setBusy]=useState(true),[reading,setReading]=useState<string|null>(null),[notice,setNotice]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    catalogRequest<Inbox>(`/api/admin/inquiries?page=${page}&filter=${filter}`,{signal:controller.signal}).then(result=>{setData(result);setError('');if(page>1&&!result.items.length)setPage(Math.max(1,Math.ceil(result.total/12)));}).catch(e=>{if(!controller.signal.aborted)setError(e.message||'Chưa thể tải yêu cầu.');}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>controller.abort();
  },[page,filter,revision]);
  useEffect(()=>{
    const connection=io({withCredentials:true,addTrailingSlash:false});
    connection.on('inquiry:received',()=>{setNotice('Có yêu cầu tư vấn mới. Danh sách đã được cập nhật.');setRevision(value=>value+1);});
    connection.on('connect',()=>setRevision(value=>value+1));
    // Durable inbox remains usable when WebSockets or a worker restart interrupts delivery.
    const timer=setInterval(()=>{if(document.visibilityState==='visible')setRevision(value=>value+1);},30000);
    return()=>{clearInterval(timer);connection.disconnect();};
  },[]);
  async function read(id:string){setReading(id);try{await catalogRequest(`/api/admin/inquiries/${id}/read`,{method:'POST'});setRevision(value=>value+1);}catch(e){setError(e instanceof Error ? e.message:'Chưa thể ghi nhận đã xem.');}finally{setReading(null);}}
  return <main className="discovery-main container"><Link href="/admin" className="text-link"><ArrowLeft size={16}/> Quản lý bất động sản</Link><div className="discovery-heading"><span className="eyebrow">TIẾP NHẬN KHÁCH HÀNG</span><h1>Yêu cầu tư vấn</h1><p><Bell size={16}/> {data?.unread ?? 0} yêu cầu chưa xem. Các số điện thoại chưa xác minh được tiếp nhận để kiểm tra và phản hồi thủ công.</p></div>
    <div className="inbox-toolbar"><label>Hiển thị <select value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);setBusy(true);}}><option value="all">Tất cả yêu cầu</option><option value="unread">Chưa xem</option></select></label><button className="button secondary" onClick={()=>{setBusy(true);setRevision(value=>value+1);}}><RefreshCw size={16}/> Tải lại</button></div>
    {notice && <p role="status" className="inquiry-notice">{notice}</p>}{error && <p role="alert" className="discovery-field-error">{error}</p>}
    {busy ? <p role="status">Đang tải yêu cầu…</p>:data?.items.length ? <div className="customer-inquiry-list">{data.items.map(item=><article className="customer-inquiry-card" key={item.id}><div className="customer-section-heading"><h2>{item.property_name || 'Tư vấn theo nhu cầu'}</h2><span className="inquiry-status Received">{item.read_at ? 'Đã xem':'Mới'}</span></div><p>{item.name} · {new Date(item.created_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</p><p>{inquiryLabels[item.status]} · {item.phone_verified ? 'Số đã xác minh':'Số chưa xác minh'}</p><dl className="property-detail-facts"><div><dt>Số liên hệ</dt><dd>{item.phone}</dd></div><div><dt>Email</dt><dd>{item.email || 'Không cung cấp'}</dd></div><div><dt>Kênh mong muốn</dt><dd>{item.channel==='Email' ? 'Email':'Điện thoại'}</dd></div><div><dt>Thời gian phù hợp</dt><dd>{item.preferred_time || 'Chưa chọn'}</dd></div></dl><p className="property-description">{item.message}</p><p className="inquiry-permissions">Đồng ý gọi: {item.consent.call ? 'Có':'Không'} · AI giọng nói: {item.consent.ai ? 'Có':'Không'} · Bản chép lời: {item.consent.transcript ? 'Có':'Không'} · Ghi âm: {item.consent.recording ? 'Có':'Không'}</p>{!item.read_at && <button className="button secondary" disabled={reading===item.id} onClick={()=>read(item.id)}><Check size={16}/> Đánh dấu đã xem</button>}</article>)}</div>:<p className="customer-empty">Không có yêu cầu trong danh sách này.</p>}
    <div className="discovery-pagination"><button className="button secondary" disabled={page<=1||busy} onClick={()=>{setPage(value=>value-1);setBusy(true);}}>Trang trước</button><span>Trang {page} / {Math.max(1,Math.ceil((data?.total||0)/12))}</span><button className="button secondary" disabled={busy||page*12>=(data?.total||0)} onClick={()=>{setPage(value=>value+1);setBusy(true);}}>Trang sau</button></div>
  </main>;
}
