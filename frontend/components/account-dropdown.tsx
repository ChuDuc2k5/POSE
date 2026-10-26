'use client';

import Link from 'next/link';
import { BriefcaseBusiness, ChevronDown, Heart, LayoutDashboard, MessagesSquare, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LogoutButton } from './logout-button';
import { roleHome, roleLabels, type Role } from '@/lib/roles';

export function AccountDropdown({ role, name }: { role: Role; name?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Pages that do not pass the name (search, detail, …) still show it: read it once from the profile.
  const [loadedName, setLoadedName] = useState<string>();
  useEffect(() => {
    if (name?.trim()) return;
    const controller = new AbortController();
    fetch('/api/account/profile', { signal: controller.signal }).then(response => response.ok ? response.json() : null)
      .then(data => { const value = data?.profile?.name; if (typeof value === 'string' && value.trim()) setLoadedName(value.trim()); })
      .catch(() => {});
    return () => controller.abort();
  }, [name]);
  const displayName = name?.trim() || loadedName || 'Tài khoản';
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(true); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keyboard); };
  }, [open]);
  const destination = roleHome(role);
  return <div className="account-dropdown" ref={root}><Link className="account-menu-server-hint" href={destination}>Trang chủ của tôi</Link><span className="account-menu-server-hint">Hồ sơ cá nhân Đăng xuất</span>
    <button ref={trigger} type="button" className="account-trigger" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(value => !value)}><span className="account-avatar-small">{displayName.charAt(0).toUpperCase()}</span><span>{displayName}</span><ChevronDown size={15} className={open ? 'is-open' : ''}/></button>
    {open && <div className="account-menu" role="menu"><div className="account-role" role="presentation"><span className="account-avatar-large">{displayName.charAt(0).toUpperCase()}</span><span><strong>{displayName}</strong><small>{roleLabels[role]}</small></span></div>
      <Link href="/account" role="menuitem" onClick={() => close()}><UserRound size={17}/>Hồ sơ cá nhân</Link>
      {role === 'User' ? <><Link href="/customer/favorites" role="menuitem" onClick={() => close()}><Heart size={17}/>Bất động sản đã lưu</Link><Link href="/customer/inquiries" role="menuitem" onClick={() => close()}><MessagesSquare size={17}/>Yêu cầu tư vấn</Link></> : role === 'Admin' ? <><Link href="/admin" role="menuitem" onClick={() => close()}><LayoutDashboard size={17}/>Admin dashboard</Link><Link href="/sales" role="menuitem" onClick={() => close()}><BriefcaseBusiness size={17}/>Không gian Sales</Link></> : <Link href="/sales" role="menuitem" onClick={() => close()}><BriefcaseBusiness size={17}/>Không gian Sales</Link>}
      <LogoutButton menuItem/>
    </div>}
  </div>;
}
