'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { io } from 'socket.io-client';
export function InquiryInboxLink(){
  const [unread,setUnread]=useState<number|null>(null);
  useEffect(()=>{
    let live=true;
    const reload=()=>{void fetch('/api/admin/inquiries?page=1&filter=unread',{cache:'no-store'}).then(response=>response.ok ? response.json():null).then(data=>{if(live&&data)setUnread(data.unread);}).catch(()=>{});};
    const connection=io({withCredentials:true,addTrailingSlash:false});connection.on('inquiry:received',reload);connection.on('connect',reload);reload();
    const timer=setInterval(()=>{if(document.visibilityState==='visible')reload();},30000);
    return()=>{live=false;clearInterval(timer);connection.disconnect();};
  },[]);
  return <Link className="button secondary" href="/admin/inquiries"><Bell size={17}/> Yêu cầu tư vấn{unread!==null && unread>0 ? ` (${unread})`:''}</Link>;
}
