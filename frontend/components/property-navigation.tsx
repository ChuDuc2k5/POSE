'use client';

import Link from 'next/link';
import { Building2, ChevronDown, Home, ShoppingBag } from 'lucide-react';
import { useState } from 'react';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/properties?transaction=Rent', label: 'Cho thuê', description: 'Khám phá các lựa chọn đang cho thuê.', icon: Home },
  { href: '/properties?transaction=Sale', label: 'Mua bán', description: 'Tìm bất động sản phù hợp để sở hữu.', icon: ShoppingBag },
  { href: '/properties', label: 'Tất cả bất động sản', description: 'Xem toàn bộ danh mục TERAVA.', icon: Building2 },
];

export function PropertyNavigation() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return <div className="property-menu" aria-current={pathname.startsWith('/properties') ? 'page' : undefined} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <button type="button" className="property-menu-trigger" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>Bất động sản <ChevronDown size={15} aria-hidden="true" className={open ? 'is-open' : ''}/></button>
    {open && <div className="property-menu-panel" role="menu">{items.map(({ href, label, description, icon: Icon }) => <Link href={href} role="menuitem" key={label} onClick={() => setOpen(false)}><Icon size={18} aria-hidden="true"/><span><strong>{label}</strong><small>{description}</small></span></Link>)}</div>}
  </div>;
}
