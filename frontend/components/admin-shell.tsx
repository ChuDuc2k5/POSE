'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Activity, ArrowRight, Building2, CalendarDays, ChartColumn, Contact, FolderKanban, Layers3, Menu, Phone, Radio, Users, UserRound, X } from 'lucide-react';
import { Brand } from './brand';
import { InquiryInboxLink } from './inquiry-inbox-link';
import { LogoutButton } from './logout-button';

const catalogLinks = [
  { label: 'Sản phẩm', href: '/admin?kind=properties', kind: 'properties', Icon: Building2 },
  { label: 'Dự án', href: '/admin?kind=projects', kind: 'projects', Icon: FolderKanban },
  { label: 'Phân khu', href: '/admin?kind=subdivisions', kind: 'subdivisions', Icon: Layers3 },
] as const;

export function AdminShell({ name, children }: { name: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const kind = params.get('kind') || 'properties';
  const active = pathname === '/admin' ? kind : pathname.startsWith('/admin/inquiries') ? 'inquiries' : pathname.startsWith('/admin/leads') ? 'leads' : pathname.startsWith('/admin/campaigns') ? 'campaigns' : pathname.startsWith('/admin/calls') ? 'calls' : pathname.startsWith('/admin/ai-dashboard') ? 'ai' : pathname.startsWith('/admin/sales') ? 'sales' : '';
  const close = () => setOpen(false);
  return <main className="catalog-workspace admin-shell">
    <aside className={`catalog-sidebar admin-sidebar${open ? ' is-open' : ''}`}>
      <Brand light={false} href="/admin" />
      <div className="catalog-sidebar-label">KHÔNG GIAN QUẢN TRỊ</div>
      <nav aria-label="Quản trị">
        {catalogLinks.map(({ label, href, kind: linkKind, Icon }) => <Link key={linkKind} href={href} className={active === linkKind ? 'active' : undefined} aria-current={active === linkKind ? 'page' : undefined} onClick={close}><Icon size={19} />{label}<ArrowRight size={15} /></Link>)}
        <InquiryInboxLink active={active === 'inquiries'} onNavigate={close} />
        <Link href="/admin/leads" className={active === 'leads' ? 'active' : undefined} aria-current={active === 'leads' ? 'page' : undefined} onClick={close}><Contact size={19} />Quản lý Lead<ArrowRight size={15} /></Link>
        <Link href="/reports" onClick={close}><ChartColumn size={19} />Báo cáo Lead<ArrowRight size={15} /></Link>
        <Link href="/appointments" onClick={close}><CalendarDays size={19} />Lịch hẹn<ArrowRight size={15} /></Link>
        <Link href="/admin/campaigns" className={active === 'campaigns' ? 'active' : undefined} aria-current={active === 'campaigns' ? 'page' : undefined} onClick={close}><Radio size={19} />Chiến dịch gọi<ArrowRight size={15} /></Link>
        <Link href="/admin/calls" className={active === 'calls' ? 'active' : undefined} aria-current={active === 'calls' ? 'page' : undefined} onClick={close}><Phone size={19} />Cuộc gọi<ArrowRight size={15} /></Link>
        <Link href="/admin/ai-dashboard" className={active === 'ai' ? 'active' : undefined} aria-current={active === 'ai' ? 'page' : undefined} onClick={close}><Activity size={19} />AI Platform<ArrowRight size={15} /></Link>
        <Link href="/admin/sales" className={active === 'sales' ? 'active' : undefined} aria-current={active === 'sales' ? 'page' : undefined} onClick={close}><Users size={19} />Quản lý Sales<ArrowRight size={15} /></Link>
      </nav>
      <div className="catalog-sidebar-bottom"><Link href="/account" onClick={close}><UserRound size={17} />Hồ sơ cá nhân<ArrowRight size={14} /></Link><Link href="/" onClick={close}><Building2 size={17} />Trang chủ<ArrowRight size={14} /></Link><LogoutButton /></div>
    </aside>
    <section className="catalog-workspace-main">
      <header className="catalog-topbar"><button type="button" className="admin-menu-button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-label={open ? 'Đóng menu' : 'Mở menu'}>{open ? <X size={20} /> : <Menu size={20} />}</button><div aria-label="Đường dẫn"><Link href="/admin">Quản trị</Link><span>›</span><strong>{active === 'properties' ? 'Sản phẩm' : active === 'projects' ? 'Dự án' : active === 'subdivisions' ? 'Phân khu' : active === 'inquiries' ? 'Yêu cầu tư vấn' : active === 'leads' ? 'Quản lý Lead' : active === 'campaigns' ? 'Chiến dịch gọi' : active === 'calls' ? 'Cuộc gọi' : active === 'ai' ? 'AI Platform' : active === 'sales' ? 'Quản lý Sales' : 'Quản trị'}</strong></div><Link href="/account" className="catalog-admin-user"><span>{name.slice(0, 1).toUpperCase()}</span><div><strong>{name}</strong><small>Quản trị viên</small></div></Link></header>
      <div className="catalog-content">{children}</div>
    </section>
  </main>;
}
