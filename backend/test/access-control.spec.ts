import { ForbiddenException, UnauthorizedException, ServiceUnavailableException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard, assertResourceOwner } from '../src/auth/auth.guard.js';
import { AccessController } from '../src/auth/access.controller.js';

describe('API authorization', () => {
  const guard = new AuthGuard(new Reflector());
  let role = 'User';
  let active = true;
  let validSession = true;
  let request: { headers: Record<string, string>; principal?: unknown };
  const context = (handler: 'me' | 'admin' | 'sales') => ({
    getHandler: () => AccessController.prototype[handler],
    getClass: () => AccessController,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://provider.example');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'fixture-public');
    role = 'User'; active = true; validSession = true;
    request = { headers: { authorization: 'Bearer fixture-token' } };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith('/user')
        ? { id: 'customer-id', email: 'fixture@example.test', email_confirmed_at: '2026-10-05', user_metadata: { role: 'Admin' } }
        : { user_id: 'customer-id', role, active, session_valid: validSession },
    ), { status: 200 })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('rejects anonymous requests without contacting the provider', async () => {
    request.headers = {};
    await expect(guard.canActivate(context('me'))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not trust a role in user metadata or request headers', async () => {
    request.headers['x-role'] = 'Admin';
    await expect(guard.canActivate(context('admin'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(context('sales'))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('allows Sales workspace and rejects admin operations', async () => {
    role = 'Sales';
    expect(await guard.canActivate(context('sales'))).toBe(true);
    await expect(guard.canActivate(context('admin'))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('allows Admin and rechecks a role downgrade on the next request', async () => {
    role = 'Admin';
    expect(await guard.canActivate(context('admin'))).toBe(true);
    role = 'User';
    await expect(guard.canActivate(context('admin'))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects suspended users and revoked sessions', async () => {
    active = false;
    await expect(guard.canActivate(context('me'))).rejects.toBeInstanceOf(UnauthorizedException);
    active = true; validSession = false;
    await expect(guard.canActivate(context('me'))).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('fails closed during provider outages', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    await expect(guard.canActivate(context('me'))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('rejects forged tokens and mismatched resource owners', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(guard.canActivate(context('me'))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(() => assertResourceOwner({ id: 'sales-a', email: '', role: 'Sales' }, 'sales-b')).toThrow(ForbiddenException);
    expect(() => assertResourceOwner({ id: 'sales-a', email: '', role: 'Sales' }, 'sales-a')).not.toThrow();
  });
});
