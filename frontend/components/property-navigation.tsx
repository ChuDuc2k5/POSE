'use client';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

export function PropertyNavigation({ mobile = false }: { mobile?: boolean }) {
  const [open, setOpen] = useState(false);
  return <div className={`property-menu ${mobile ? 'property-menu-mobile' : ''}`} onMouseEnter={() => !mobile && setOpen(true)} onMouseLeave={() => !mobile && setOpen(false)}>
    <button type="button" className="property-menu-trigger" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
      Bất động sản <ChevronDown size={15} aria-hidden="true" className={open ? 'is-open' : ''}/>
    </button>
    {open && <div className="property-menu-panel" role="menu">
      <Link href="/properties?transaction=Rent" role="menuitem" onClick={() => setOpen(false)}>Cho thuê</Link>
      <Link href="/properties?transaction=Sale" role="menuitem" onClick={() => setOpen(false)}>Mua bán</Link>
      <Link href="/properties" role="menuitem" onClick={() => setOpen(false)}>Tất cả bất động sản</Link>
    </div>}
  </div>;
}
