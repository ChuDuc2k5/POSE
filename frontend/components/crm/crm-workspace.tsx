'use client';
import Link, { useLinkStatus } from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type SetStateAction } from 'react';
import { LoaderCircle } from 'lucide-react';
import { catalogRequest } from '@/lib/catalog-client';
import { CrmStore, emptyCrmSnapshot } from '@/lib/crm-store';
import { AccountDropdown } from '../account-dropdown';
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
function NavigationStatus() {
  const { pending } = useLinkStatus();
  return pending ? <LoaderCircle className={s.spinner} size={13} aria-label="Đang chuyển chức năng"/> : null;
}
function Header() {
  const { role, name, store } = useCrmWorkspace(), pathname = usePathname();
  return <header className={s.header} data-crm-header><div className={s.headerInner}>
    <Link href="/" className={s.brand} aria-label="TERAVA — Trang chủ"><span>T</span><div><strong>TERAVA</strong><small>Kết nối bất động sản & khách hàng</small></div></Link>
    <nav aria-label="Điều hướng Lead và Sales"><Link href="/">Trang chủ</Link>{[['/leads', 'Quản lý Lead', 'leads'], ['/sales', 'Không gian Sales', 'sales']].map(([href, label, module]) => <Link key={href} href={href} prefetch className={pathname === href ? s.active : ''} aria-current={pathname === href ? 'page' : undefined} onPointerEnter={() => { void store.prefetch(module as 'leads' | 'sales'); }} onFocus={() => { void store.prefetch(module as 'leads' | 'sales'); }}>{label}<NavigationStatus/></Link>)}</nav>
    <div className={s.accountMenu}><AccountDropdown role={role} name={name}/></div>
  </div></header>;
}
// `embedded` drops the CRM header when the admin shell already provides navigation.
export function CrmWorkspace({ identity, embedded = false, children }: { identity: Identity; embedded?: boolean; children: ReactNode }) {
  const router = useRouter();
  const [store] = useState(() => new CrmStore((url, signal) => catalogRequest(url, { signal }), () => router.refresh()));
  useEffect(() => () => store.dispose(), [store]);
  return <Context.Provider value={{ ...identity, store }}><div className={embedded ? s.embedded : s.workspace}>{!embedded && <Header/>}{children}</div></Context.Provider>;
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
