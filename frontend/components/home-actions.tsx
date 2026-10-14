'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';

export function HomeActions() {
  const [destination,setDestination]=useState<string|null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/auth/me',{signal:controller.signal,cache:'no-store'}).then(async response=>{
      if (!response.ok) return;
      const data=await response.json();
      if (['/customer','/sales','/admin'].includes(data.destination)) setDestination(data.destination);
    }).catch(()=>{});
    return()=>controller.abort();
  },[]);
  return <div className="hero-actions"><Link href={destination || '/sign-in'} className="button primary">{destination ? destination==='/customer' ? 'Trang chủ của tôi':'Mở không gian làm việc':'Đăng nhập'} <ArrowUpRight size={19}/></Link><Link href="#chuc-nang" className="text-link">Khám phá NexCall <ArrowRight size={17}/></Link></div>;
}
