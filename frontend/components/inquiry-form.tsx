'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, Send } from 'lucide-react';
import type { Profile } from '@/lib/account-server';
import { CatalogRequestError, catalogRequest } from '@/lib/catalog-client';
import { inquiryLabels } from '@/lib/discovery';

export function InquiryForm({ propertyId=null,propertyName }: { propertyId?:string|null;propertyName?:string }) {
  const [identity,setIdentity]=useState<'loading'|'customer'|'guest'|'staff'|'error'>('loading');
  const [name,setName]=useState(''),[phone,setPhone]=useState(''),[country,setCountry]=useState(''),[email,setEmail]=useState('');
  const [channel,setChannel]=useState('Email'),[preferredTime,setPreferredTime]=useState(''),[message,setMessage]=useState('');
  const [consent,setConsent]=useState({contact:false,call:false,ai:false,transcript:false,recording:false});
  const [fields,setFields]=useState<Record<string,string>>({}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [result,setResult]=useState<{id:string;status:keyof typeof inquiryLabels}|null>(null);
  const key=useRef<string|null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/auth/me',{cache:'no-store',signal:controller.signal}).then(async response=>{
      if(response.status===401){setIdentity('guest');return;}
      if(!response.ok)throw new Error();
      const me=await response.json();if(me.user.role!=='User'){setIdentity('staff');return;}
      const data=await catalogRequest<{profile:Profile}>('/api/account/profile',{signal:controller.signal});
      setIdentity('customer');setName(data.profile.name);setPhone(data.profile.phone);setEmail(me.user.email);
    }).catch(()=>{if(!controller.signal.aborted)setIdentity('error');});
    return()=>controller.abort();
  },[]);
  async function submit(event:FormEvent){
    event.preventDefault();setBusy(true);setError('');setFields({});
    key.current ||= crypto.randomUUID();
    try { const data=await catalogRequest<{id:string;status:keyof typeof inquiryLabels}>('/api/customer/inquiries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({property_id:propertyId,name,phone,country,channel,preferred_time:preferredTime,message,consent,request_key:key.current})});setResult(data); }
    catch(e){setError(e instanceof Error ? e.message:'Chưa thể gửi yêu cầu.');if(e instanceof CatalogRequestError)setFields(e.fields);}
    finally{setBusy(false);}
  }
  const fieldError=(field:string)=>fields[field] && <span className="discovery-field-error">{fields[field]}</span>;
  return <section className="inquiry-panel" id="tu-van"><span className="eyebrow">ĐỂ NEXCALL ĐỒNG HÀNH CÙNG BẠN</span><h2>Gửi yêu cầu tư vấn</h2><p>{propertyName ? `Bạn đang quan tâm: ${propertyName}.`:'Chia sẻ nhu cầu để đội ngũ tư vấn tiếp nhận.'}</p>{identity==='loading' ? <p role="status">Đang tải thông tin tài khoản…</p> : identity==='guest' ? <div className="inquiry-login"><p>Đăng nhập tài khoản khách hàng để gửi yêu cầu và theo dõi phản hồi.</p><Link href="/sign-in" className="button primary">Đăng nhập</Link></div> : identity==='staff' ? <p>Vui lòng sử dụng tài khoản khách hàng để gửi yêu cầu tư vấn.</p> : identity==='error' ? <p role="alert">Chưa thể tải thông tin tài khoản. Vui lòng tải lại trang.</p> : result ? <div className="inquiry-success" role="status"><CheckCircle2 size={30}/><h3>Đã ghi nhận yêu cầu của bạn</h3><p>{inquiryLabels[result.status]}</p>{result.status==='PendingVerification' && <p>Lưu và xác minh đúng số <strong>{phone}</strong> trong hồ sơ, sau đó chọn “Kiểm tra xác minh” trong danh sách yêu cầu.</p>}<Link href="/customer/inquiries" className="button primary">Xem yêu cầu của tôi</Link>{result.status==='PendingVerification' && <Link href="/account" className="text-link">Xác minh số điện thoại</Link>}</div> : <form onSubmit={submit} onChange={()=>{key.current=null;}}><fieldset disabled={busy}><div className="inquiry-form-grid"><label>Họ tên<input name="name" required minLength={2} maxLength={80} value={name} onChange={e=>setName(e.target.value)}/>{fieldError('name')}</label><label>Email đã xác minh<input value={email} readOnly aria-label="Email đã xác minh"/></label><label>Quốc gia của số liên hệ<select name="country" required value={country} onChange={e=>setCountry(e.target.value)}><option value="">Chọn quốc gia / định dạng</option><option value="VN">Việt Nam (+84)</option><option value="International">Quốc tế — nhập mã quốc gia</option></select>{fieldError('country')}</label><label>Số điện thoại<input name="phone" type="tel" required value={phone} onChange={e=>setPhone(e.target.value)} placeholder={country==='VN' ? '0912345678':'+12025550123'}/>{fieldError('phone')}</label><label>Kênh liên hệ mong muốn<select name="channel" value={channel} onChange={e=>setChannel(e.target.value)}><option value="Email">Email</option><option value="Phone">Điện thoại</option></select>{fieldError('channel')}</label><label>Thời gian liên hệ phù hợp<input name="preferred_time" maxLength={200} value={preferredTime} onChange={e=>setPreferredTime(e.target.value)} placeholder="Ví dụ: 14:00–16:00 các ngày trong tuần"/></label></div><label>Nhu cầu của bạn<textarea name="message" rows={4} required={!propertyId} minLength={propertyId ? undefined:10} maxLength={3000} value={message} onChange={e=>setMessage(e.target.value)} placeholder="Ngân sách, khu vực mong muốn và thông tin cần được tư vấn…"/>{fieldError('message')}</label><div className="inquiry-consent"><p>Thông tin dùng để tiếp nhận yêu cầu, xác minh liên hệ và tư vấn theo lựa chọn của bạn. Bạn có thể chọn email khi không muốn nhận cuộc gọi.</p>{([
    ['contact','Đồng ý sử dụng tên và thông tin liên hệ để xử lý yêu cầu tư vấn.'],
    ['call','Đồng ý nhận cuộc gọi tư vấn.'],
    ['ai','Đồng ý xử lý giọng nói bằng AI khi có cuộc gọi.'],
    ['transcript','Đồng ý lưu bản chép lời cuộc gọi.'],
    ['recording','Đồng ý ghi âm và lưu cuộc gọi.'],
  ] as const).map(([value,label])=><label key={value}><input type="checkbox" checked={consent[value]} required={value==='contact'} onChange={e=>setConsent({...consent,[value]:e.target.checked})}/><span>{label}{value==='contact' && <small> Bắt buộc để gửi yêu cầu</small>}</span></label>)}{fieldError('consent')}<Link href="/terms" className="text-link">Điều khoản & quyền riêng tư</Link></div>{error && <p className="discovery-field-error" role="alert">{error}</p>}<button className="button primary" type="submit" disabled={busy}><Send size={17}/>{busy ? 'Đang gửi…':'Gửi yêu cầu tư vấn'}</button></fieldset></form>}</section>;
}
