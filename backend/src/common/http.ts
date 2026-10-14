import { AsyncLocalStorage } from 'node:async_hooks';
import { Readable } from 'node:stream';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

export class WebRequest extends Request {
  get nextUrl() { return new URL(this.url); }
}
export class WebResponse extends Response {
  static redirect(url: string | URL, status = 307) { return new WebResponse(null, { status, headers: { Location: String(url) } }); }
}
type CookieOptions = { httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string; maxAge?: number };
const context = new AsyncLocalStorage<{ request: ExpressRequest; values: Map<string,string>; changes: Map<string,string> }>();
export function requestClientIp() {
  const request = context.getStore()?.request;
  if (!request) throw new Error('REQUEST_CONTEXT_REQUIRED');
  return clientIp(request);
}
export function bearerToken() {
  const token = context.getStore()?.request.headers.authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
  return token && token.length <= 8192 ? token : undefined;
}
export async function cookies() {
  const store = context.getStore();
  if (!store) throw new Error('REQUEST_CONTEXT_REQUIRED');
  return {
    get: (name: string) => store.values.has(name) ? { value: store.values.get(name)! } : undefined,
    set: (name: string, value: string, options: CookieOptions = {}) => {
      store.values.set(name, value);
      store.changes.set(name, `${name}=${encodeURIComponent(value)}; Path=${options.path || '/'}${options.maxAge !== undefined ? `; Max-Age=${options.maxAge}` : ''}${options.httpOnly ? '; HttpOnly' : ''}${options.secure ? '; Secure' : ''}${options.sameSite ? `; SameSite=${options.sameSite}` : ''}`);
    },
    delete: (name: string) => { store.values.delete(name); store.changes.set(name, `${name}=; Path=/; Max-Age=0`); },
  };
}
export function frontendOrigins() { return (process.env.FRONTEND_URL || 'http://localhost:3000').split(',').map(s => s.trim()).filter(Boolean); }
export function validOrigin(request: WebRequest) { return frontendOrigins().includes(request.headers.get('origin') || ''); }
export function trustedProxy(address: string | undefined) {
  const trusted = (process.env.TRUSTED_PROXY_IPS || '127.0.0.1,::1,::ffff:127.0.0.1').split(',').map(s => s.trim());
  return Boolean(address && trusted.includes(address));
}
export function clientIp(request: ExpressRequest) {
  const forwarded = request.headers['x-forwarded-for'];
  return trustedProxy(request.socket?.remoteAddress) && typeof forwarded === 'string' ? forwarded.split(',').at(-1)!.trim() : request.socket?.remoteAddress || 'unknown';
}
type Handler<P> = (request: WebRequest, context: { params: Promise<P> }) => Promise<Response | undefined>;
export async function dispatch<P>(request: ExpressRequest, response: ExpressResponse, handler: Handler<P>) {
  await withCookieContext(request, response, async () => {
    const headers = new Headers();
    for (const [key,value] of Object.entries(request.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    const origin = frontendOrigins().find(o => o === headers.get('origin')) || frontendOrigins()[0];
    const forwardedHost = headers.get('x-forwarded-host');
    const proxyHost = trustedProxy(request.socket.remoteAddress) && forwardedHost ? forwardedHost.split(',')[0].trim() : '';
    const host = frontendOrigins().some(o => new URL(o).host === proxyHost) ? proxyHost : new URL(origin).host;
    const protocol = new URL(origin).protocol;
    const url = `${protocol}//${host}${request.originalUrl}`;
    const init: RequestInit & { duplex?: string } = { method: request.method, headers };
    if (!['GET','HEAD'].includes(request.method)) { init.body = Readable.toWeb(request) as ReadableStream<Uint8Array>; init.duplex = 'half'; }
    const result = await handler(new WebRequest(url, init), { params: Promise.resolve(request.params as P) });
    if (!result) throw new Error('EMPTY_RESPONSE');
    response.status(result.status);
    result.headers.forEach((value,key) => { if (key !== 'set-cookie') response.setHeader(key,value); });
    const setCookies = [...result.headers.getSetCookie(), ...context.getStore()!.changes.values()];
    if (setCookies.length) response.setHeader('Set-Cookie',setCookies);
    response.end(Buffer.from(await result.arrayBuffer()));
  });
}

export async function withCookieContext<T>(request: ExpressRequest, response: ExpressResponse | undefined, callback: () => Promise<T>): Promise<T> {
  const values = new Map<string,string>();
  for (const cookie of (request.headers.cookie || '').split(';')) {
    const index = cookie.indexOf('='); if (index < 0) continue;
    try { values.set(cookie.slice(0,index).trim(), decodeURIComponent(cookie.slice(index+1))); } catch { /* Ignore malformed cookies. */ }
  }
  const changes = new Map<string,string>();
  return context.run({ request, values, changes }, async () => {
    try { return await callback(); }
    finally { if (changes.size && response && !response.headersSent) response.setHeader('Set-Cookie', [...changes.values()]); }
  });
}
