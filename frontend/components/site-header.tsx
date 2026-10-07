'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Menu, X, UserRound } from 'lucide-react';
import { Brand } from './brand';
import { LogoutButton } from './logout-button';
import { roleHome, roleLabels, type Role } from '@/lib/roles';
export function SiteHeader({ role }: { role: Role | null }) {
  const [open, setOpen] = useState(false);
  const loggedIn = role !== null;
  const destination = role ? roleHome(role) : '/';
  return <header className="site-header"><div className="container header-inner"><Brand href={loggedIn ? destination : '/'}/><button className="menu-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="site-navigation" aria-label={open ? 'Đóng menu' : 'Mở menu'}>{open ? <X/> : <Menu/>}</button><nav id="site-navigation" className={open ? 'nav-open' : ''}><Link href="/properties" onClick={() => setOpen(false)}>Bất động sản</Link>{!loggedIn && <Link href="/#ve-nexcall" onClick={() => setOpen(false)}>Về NexCall</Link>}<span className="nav-separator"/>{loggedIn ? <><span className="header-role">{roleLabels[role]}</span><Link href={destination} onClick={()=>setOpen(false)}>{role === 'User' ? 'Trang chủ của tôi' : 'Không gian làm việc'}</Link><Link href="/account" className="button primary" onClick={()=>setOpen(false)}><UserRound size={16}/> Hồ sơ cá nhân</Link><LogoutButton/></> : <><Link href="/sign-in">Đăng nhập</Link><Link href="/sign-up" className="button primary">Đăng ký <span>↗</span></Link></>}</nav></div></header>;
}
