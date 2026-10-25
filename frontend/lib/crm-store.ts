// One in-memory store per mounted staff workspace. Never persisted to browser storage.
export type CrmSnapshot = { data?: unknown; error: string; fetching: boolean; updatedAt: number };
export const emptyCrmSnapshot: CrmSnapshot = { error: '', fetching: false, updatedAt: 0 };
type Pending = { controller: AbortController; promise: Promise<void> };
export class CrmStore {
  private entries = new Map<string, CrmSnapshot>();
  private pending = new Map<string, Pending>();
  private states = new Map<string, unknown>();
  private listeners = new Set<() => void>();
  private active = new Map<string, number>();
  private lastRequests = new Map<string, string>();
  private generation = 0;
  private blockedError: CrmSnapshot | null = null;
  private request: (url: string, signal: AbortSignal) => Promise<unknown>;
  private denied: () => void;
  constructor(request: (url: string, signal: AbortSignal) => Promise<unknown>, denied: () => void) {
    this.request = request; this.denied = denied;
  }
  key(url: string) {
    const [path, query] = url.split('?');
    if (!/^\/api\/(?:leads|sales)(?:\/|$)/.test(path)) throw new Error('CRM_QUERY_OUT_OF_SCOPE');
    const params = new URLSearchParams(query); params.sort();
    return path + (params.size ? '?' + params : '');
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  subscribeQuery(url: string, listener: () => void) {
    const key = this.key(url);
    this.active.set(key, (this.active.get(key) || 0) + 1);
    const unsubscribe = this.subscribe(listener);
    return () => { unsubscribe(); const count = (this.active.get(key) || 1) - 1; if (count) this.active.set(key, count); else this.active.delete(key); };
  }
  version = () => this.generation;
  private emit() { for (const listener of this.listeners) listener(); }
  snapshot(url: string) { const key = this.key(url); return this.blockedError || this.entries.get(key) || emptyCrmSnapshot; }
  state<T>(key: string, fallback: T): T { return this.states.has(key) ? this.states.get(key) as T : fallback; }
  setState<T>(key: string, fallback: T, value: T | ((current: T) => T)) {
    this.states.set(key, typeof value === 'function' ? (value as (current: T) => T)(this.state(key, fallback)) : value);
    this.emit();
  }
  remember(module: 'leads' | 'sales', url: string) { this.lastRequests.set(module, this.key(url)); }
  async prefetch(module: 'leads' | 'sales') {
    const url = this.lastRequests.get(module) || (module === 'leads' ? '/api/leads?page=1&pageSize=12&archived=false' : '/api/sales/leads?page=1&pageSize=12');
    await Promise.all([this.load(url), this.load('/api/' + module + '/options')]);
  }
  invalidate = () => {
    // A GET started before a successful write must never replace newer data afterwards.
    for (const p of this.pending.values()) p.controller.abort();
    this.pending.clear();
    this.blockedError = null;
    for (const [key, entry] of this.entries) this.entries.set(key, { ...entry, fetching: false, updatedAt: 0 });
    this.generation++; this.emit();
  };
  load(url: string, force = false): Promise<void> {
    const key = this.key(url), existing = this.pending.get(key);
    if (this.blockedError) return Promise.resolve();
    if (existing) return existing.promise;
    const before = this.entries.get(key);
    if (!force && before?.data !== undefined && Date.now() - before.updatedAt < 15000) return Promise.resolve();
    const controller = new AbortController();
    const operation: Pending = { controller, promise: Promise.resolve() };
    this.pending.set(key, operation);
    this.entries.set(key, { ...before, error: '', fetching: true, updatedAt: before?.updatedAt || 0 });
    this.emit();
    operation.promise = this.request(key, controller.signal).then(data => {
      if (this.pending.get(key) !== operation) return;
      this.entries.set(key, { data, error: '', fetching: false, updatedAt: Date.now() });
      // Bound cached result pages while keeping the most recently used ones.
      if (this.entries.size > 40) for (const old of this.entries.keys()) {
        if (old !== key && !this.pending.has(old) && !this.active.has(old) && ![...this.lastRequests.values()].includes(old)) this.entries.delete(old);
        if (this.entries.size <= 40) break;
      }
    }).catch((error: unknown) => {
      if (this.pending.get(key) !== operation || controller.signal.aborted) return;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN') {
        this.dispose();
        this.blockedError = { error: error instanceof Error ? error.message : 'Vui lòng kiểm tra lại quyền truy cập.', fetching: false, updatedAt: 0 };
        this.generation++; this.emit(); this.denied(); return;
      }
      this.entries.set(key, { ...before, error: error instanceof Error ? error.message : 'Chưa thể tải dữ liệu.', fetching: false, updatedAt: 0 });
    }).finally(() => {
      if (this.pending.get(key) === operation) { this.pending.delete(key); this.emit(); }
    });
    return operation.promise;
  }
  dispose() {
    for (const p of this.pending.values()) p.controller.abort();
    this.pending.clear(); this.entries.clear(); this.states.clear(); this.lastRequests.clear();
  }
}
