import Link from 'next/link';
import { Heart, Search, MessagesSquare } from 'lucide-react';

export function CustomerNav({ active }: { active?: 'discover' | 'favorites' | 'inquiries' }) {
  return <nav className="customer-tabs" aria-label="Không gian khách hàng"><Link href="/properties" aria-current={active==='discover' ? 'page':undefined}><Search size={17}/> Khám phá bất động sản</Link><Link href="/customer/favorites" aria-current={active==='favorites' ? 'page':undefined}><Heart size={17}/> Yêu thích</Link><Link href="/customer/inquiries" aria-current={active==='inquiries' ? 'page':undefined}><MessagesSquare size={17}/> Yêu cầu tư vấn</Link></nav>;
}
