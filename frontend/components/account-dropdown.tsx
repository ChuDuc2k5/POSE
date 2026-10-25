'use client';
import Link from 'next/link';
import { ChevronDown, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LogoutButton } from './logout-button';
import { roleHome, roleLabels, type Role } from '@/lib/roles';

export function AccountDropdown({ role, name }: { role: Role; name?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null); const menu = useRef<HTMLDivElement>(null);
  const displayName = name?.trim() || 'Tài khoản';
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
      if (!menu.current || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const items = Array.from(menu.current.querySelectorAll<HTMLElement>('[role="menuitem"]')); const current = items.indexOf(document.activeElement as HTMLElement); event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; items[next]?.focus();
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', keyboard); menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keyboard); };
  }, [open]);
  const destination = roleHome(role);
  return <div className="account-dropdown" ref={root}>
    <button ref={trigger} type="button" className="account-trigger" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(value => !value)}><UserRound size={17}/><span>{displayName}</span><ChevronDown size={15} className={open ? 'is-open' : ''}/></button>
    {open && <div ref={menu} className="account-menu" role="menu"><div className="account-role" role="presentation">{roleLabels[role]}</div>
      <Link href="/account" role="menuitem" onClick={() => close()}>Hồ sơ cá nhân</Link>
      {role === 'User' ? <><Link href={destination} role="menuitem" onClick={() => close()}>Trang chủ của tôi</Link><Link href="/customer/favorites" role="menuitem" onClick={() => close()}>Bất động sản đã lưu</Link><Link href="/customer/inquiries" role="menuitem" onClick={() => close()}>Yêu cầu tư vấn</Link></> : <Link href={destination} role="menuitem" onClick={() => close()}>Không gian làm việc</Link>}
      <LogoutButton menuItem/>
    </div>}
  </div>;
}
