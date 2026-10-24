'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Brand } from './brand';
import { PropertyNavigation } from './property-navigation';
import { AccountDropdown } from './account-dropdown';
import { roleHome, type Role } from '@/lib/roles';

export function SiteHeader({ role, name }: { role: Role | null; name?: string }) {
  const [open, setOpen] = useState(false);
  const loggedIn = role !== null;
  const destination = role ? roleHome(role) : '/';
  return <header className="site-header"><div className="header-inner"><Brand light={false} href={loggedIn ? destination : '/'}/><button className="menu-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="site-navigation" aria-label={open ? 'Đóng menu' : 'Mở menu'}>{open ? <X/> : <Menu/>}</button><nav id="site-navigation" className={open ? 'nav-open' : ''}>
    <PropertyNavigation/>
    {!loggedIn && <Link href="/#ve-nexcall" onClick={() => setOpen(false)}>Về TERAVA</Link>}
    {loggedIn ? <AccountDropdown role={role} name={name}/> : <><Link href="/sign-in">Đăng nhập</Link><Link href="/sign-up" className="button primary">Đăng ký <span>↗</span></Link></>}
  </nav></div></header>;
}
