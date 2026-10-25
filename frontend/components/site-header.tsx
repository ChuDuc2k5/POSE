'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import { Brand } from './brand';
import { PropertyNavigation } from './property-navigation';
import { SupportNavigation } from './support-navigation';
import { AccountDropdown } from './account-dropdown';
import { type Role } from '@/lib/roles';

export function SiteHeader({ role, name }: { role: Role | null; name?: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const close = () => setOpen(false);
  return <header className="site-header"><div className="header-inner"><Brand light={false} href="/"/><button className="menu-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls="site-navigation" aria-label={open ? 'Đóng menu' : 'Mở menu'}>{open ? <X/> : <Menu/>}</button><nav id="site-navigation" className={open ? 'nav-open' : ''}>
    <Link href="/" aria-current={pathname === '/' ? 'page' : undefined} onClick={close}>Trang chủ</Link><PropertyNavigation/><SupportNavigation onNavigate={close}/><Link href="/#ve-nexcall" onClick={close}>Về TERAVA</Link>
    {role ? <AccountDropdown role={role} name={name}/> : <><Link href="/sign-in" onClick={close}>Đăng nhập</Link><Link href="/sign-up" className="button primary" onClick={close}>Đăng ký <span>↗</span></Link></>}
  </nav></div></header>;
}
