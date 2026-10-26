'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type SetStateAction } from 'react';
import { ArrowRight, BriefcaseBusiness, CalendarDays, ChartColumn, ChevronRight, Contact, Home, Menu, UserRound, X } from 'lucide-react';
import { catalogRequest } from '@/lib/catalog-client';
import { CrmStore, emptyCrmSnapshot } from '@/lib/crm-store';
import { AccountDropdown } from '../account-dropdown';
import { Brand } from '../brand';
import s from './crm.module.css';

type Identity = { userId: string; role: 'Admin' | 'Sales'; name: string };
const Context = createContext<(Identity & { store: CrmStore }) | null>(null);
export function useCrmWorkspace() {
  const context = useContext(Context);
  if (!context) throw new Error('CRM_WORKSPACE_REQUIRED');
  return context;
}
export function useCrmState<T>(key: string, initial: T): [T, (value: SetStateAction<T>) => void] {
  const { store } = useCrmWorkspace(), fallback = useRef(initial);
  const snapshot = useCallback(() => store.state(key, fallback.current), [key, store]);
  const server = useCallback(() => fallback.current, []);
  const value = useSyncExternalStore(store.subscribe, snapshot, server);
  const setValue = useCallback((next: SetStateAction<T>) => store.setState(key, fallback.current, next), [key, store]);
  return [value, setValue];
}
export function useCrmQuery<T>(url: string, revision = 0, module?: 'leads' | 'sales', interval = 0) {
  const { store } = useCrmWorkspace();
  const snapshot = useCallback(() => store.snapshot(url), [store, url]);
  const subscribe = useCallback((listener: () => void) => store.subscribeQuery(url, listener), [store, url]);
  const state = useSyncExternalStore(subscribe, snapshot, () => emptyCrmSnapshot);
  const generation = useSyncExternalStore(store.subscribe, store.version, () => 0);
  const lastRevision = useRef(revision);
  useEffect(() => {
    if (module) store.remember(module, url);
    const force = lastRevision.current !== revision;
    lastRevision.current = revision;
    void store.load(url, force);
  }, [store, url, revision, generation, module]);
  useEffect(() => {
    const focus = () => { if (document.visibilityState === 'visible') void store.load(url); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    const timer = interval ? setInterval(() => { if (document.visibilityState === 'visible') void store.load(url, true); }, interval) : undefined;
    return () => { window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); if (timer) clearInterval(timer); };
  }, [store, url, interval]);
  return { data: state.data as T | undefined, error: state.error, loading: state.data === undefined && !state.error, updating: state.fetching };
}
function WorkspaceShell({ children }: { children: ReactNode }) {
  const { role, name, store } = useCrmWorkspace(), pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const resize = () => { if (!media.matches) setOpen(false); };
    const back = () => setOpen(false);
    media.addEventListener('change', resize); window.addEventListener('popstate', back);
    return () => { media.removeEventListener('change', resize); window.removeEventListener('popstate', back); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const panel = sidebar.current, button = trigger.current, overflow = document.body.style.overflow;
    const focusable = () => [...(panel?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])') || [])].filter(el => el.getClientRects().length > 0);
    document.body.style.overflow = 'hidden';
    const focusFrame = requestAnimationFrame(() => focusable()[0]?.focus({ preventScroll: true }));
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
      if (event.key !== 'Tab') return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !panel?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { cancelAnimationFrame(focusFrame); document.body.style.overflow = overflow; document.removeEventListener('keydown', keyboard); button?.focus({ preventScroll: true }); };
  }, [open]);
  const links = [
    { href: '/sales/leads', label: 'Quản lý Lead', module: 'leads', Icon: Contact },
    { href: '/sales', label: 'Không gian Sales', module: 'sales', Icon: BriefcaseBusiness },
    { href: '/sales/appointments', label: 'Lịch hẹn', module: null, Icon: CalendarDays },
    { href: '/sales/reports', label: 'Báo cáo Lead', module: null, Icon: ChartColumn },
  ] as const;
  const title = pathname.endsWith('/appointments') ? 'Lịch hẹn' : pathname.endsWith('/reports') ? 'Báo cáo Lead' : pathname === '/sales' ? 'Không gian Sales' : 'Quản lý Lead';
  return <div className={s.workspace}>
    {open && <button type="button" className={s.backdrop} tabIndex={-1} onClick={close} aria-label="Đóng menu điều hướng"/>}
    <aside ref={sidebar} id="lead-sales-sidebar" className={`${s.sidebar} ${open ? s.sidebarOpen : ''}`} data-crm-sidebar role={open ? 'dialog' : undefined} aria-modal={open || undefined} aria-label="Menu Lead và Sales">
      <div className={s.sidebarBrand}><Brand light={false} href="/"/><button type="button" className={s.closeMenu} onClick={close} aria-label="Đóng menu"><X size={19}/></button></div>
      <p className={s.sidebarLabel}>KHÔNG GIAN LÀM VIỆC</p>
      <nav className={s.navigation} aria-label="Điều hướng Lead và Sales">{links.map(({ href, label, module, Icon }) => <Link key={href} href={href} prefetch className={pathname === href ? s.active : ''} aria-current={pathname === href ? 'page' : undefined} onClick={close} onPointerEnter={() => { if (module) void store.prefetch(module); }} onFocus={() => { if (module) void store.prefetch(module); }}><Icon size={19} aria-hidden="true"/><span>{label}</span><ArrowRight size={15} aria-hidden="true"/></Link>)}</nav>
      <div className={s.sidebarBottom}>{role === 'Admin' && <Link href="/admin" onClick={close}><BriefcaseBusiness size={17} aria-hidden="true"/>Về trang quản trị<ArrowRight size={14} aria-hidden="true"/></Link>}<Link href="/account" onClick={close}><UserRound size={17} aria-hidden="true"/>Hồ sơ cá nhân<ArrowRight size={14} aria-hidden="true"/></Link><Link href="/" onClick={close}><Home size={17} aria-hidden="true"/>Trang chủ<ArrowRight size={14} aria-hidden="true"/></Link></div>
    </aside>
    <div className={s.main} inert={open}>
      <header className={s.topbar} data-crm-header><div className={s.topbarStart}><button ref={trigger} type="button" className={s.menuButton} onClick={() => setOpen(true)} aria-expanded={open} aria-controls="lead-sales-sidebar" aria-label="Mở menu"><Menu size={20}/></button><div className={s.breadcrumb} aria-label="Đường dẫn"><span>Không gian làm việc</span><ChevronRight size={13} aria-hidden="true"/><strong>{title}</strong></div></div><AccountDropdown role={role} name={name}/></header>
      <div className={s.content}>{children}</div>
    </div>
  </div>;
}
// Admin's embedded Lead page keeps the navigation provided by its own shell.
export function CrmWorkspace({ identity, embedded = false, children }: { identity: Identity; embedded?: boolean; children: ReactNode }) {
  const router = useRouter();
  const [store] = useState(() => new CrmStore((url, signal) => catalogRequest(url, { signal }), () => router.refresh()));
  useEffect(() => () => store.dispose(), [store]);
  return <Context.Provider value={{ ...identity, store }}>{embedded ? <div className={s.embedded}>{children}</div> : <WorkspaceShell>{children}</WorkspaceShell>}</Context.Provider>;
}
export function CrmPage({ userId, role, children }: { userId: string; role: 'Admin' | 'Sales'; children: ReactNode }) {
  const identity = useCrmWorkspace(), router = useRouter();
  const matches = identity.userId === userId && identity.role === role;
  useEffect(() => { if (!matches) router.refresh(); }, [matches, router]);
  // A shared layout may be retained across navigation. Check its identity against
  // the fresh server authorization before rendering any cached customer data.
  return matches ? children : <CrmLoading/>;
}
export function CrmLoading() {
  return <div className={s.loading} role="status" aria-label="Đang tải chức năng"><div className={s.loadingTitle}/><div className={s.loadingText}/><div className={s.loadingMetrics}>{[1, 2, 3, 4].map(n => <span key={n}/>)}</div><div className={s.loadingPanel}/><span className={s.loadingLabel}>Đang tải nội dung…</span></div>;
}
