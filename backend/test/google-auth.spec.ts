import { createHash, createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';

describe('M01 Google OAuth through NestJS', () => {
  let app: INestApplication, provider: Server;
  let providerUrl: string;
  let enabled = true, active = true, profileExists = false, profileWrites = 0;
  let role = 'User', challenge = '', profileName = 'Khách hàng';
  let missingEmail = false, unavailable = false;
  const usedCodes = new Set<string>();
  const secret = 'test-only-google-flow-signing-secret';
  const origin = 'https://web.example';
  const user = {
    id: '00000000-0000-4000-8000-000000000002', aud: 'authenticated',
    email: 'google@example.test', email_confirmed_at: '2026-10-24T00:00:00Z',
    identities: [{ provider: 'google', id: 'google-identity' }],
    user_metadata: { full_name: 'Khách Google', role: 'Admin' }, app_metadata: {},
  };
  beforeAll(async () => {
    provider = createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const url = new URL(req.url!, 'http://localhost');
      const input = raw ? JSON.parse(raw) : {};
      const reply = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (unavailable) return reply(503, { msg: 'offline' });
      if (url.pathname.endsWith('/settings')) return reply(200, { external: { google: enabled } });
      if (url.pathname.endsWith('/token')) {
        const digest = createHash('sha256').update(input.code_verifier || '').digest('base64url');
        if (url.searchParams.get('grant_type') !== 'pkce' || input.auth_code !== 'valid-code' || usedCodes.has(input.auth_code) || digest !== challenge) {
          return reply(400, { code: 'invalid_grant', msg: 'Invalid PKCE exchange' });
        }
        usedCodes.add(input.auth_code);
        return reply(200, { access_token: 'google-access', refresh_token: 'google-refresh', expires_in: 3600, token_type: 'bearer', user: { ...user, ...(missingEmail ? { email: null } : {}) } });
      }
      if (url.pathname.endsWith('/user')) return req.headers.authorization === 'Bearer google-access' ? reply(200, user) : reply(401, { msg: 'invalid' });
      if (url.pathname.endsWith('/pose_access_context')) return reply(200, { user_id: user.id, role, active, session_valid: active });
      if (url.pathname.endsWith('/account_profiles')) return reply(200, profileExists ? [{ user_id: user.id }] : []);
      if (url.pathname.endsWith('/pose_update_profile')) {
        profileWrites++; profileExists = true; profileName = input.p_changes.name;
        return reply(200, { name: profileName, version: 1 });
      }
      if (url.pathname.endsWith('/pose_read_profile')) return reply(200, { name: profileName, avatarPath: null, version: 1 });
      return reply(404, {});
    });
    await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
    providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
    vi.stubEnv('SUPABASE_URL', providerUrl);
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'fixture-public');
    vi.stubEnv('FRONTEND_URL', origin);
    vi.stubEnv('GOOGLE_OAUTH_STATE_SECRET', secret);
    vi.stubEnv('NODE_ENV', 'production');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ bodyParser: false }); configureApp(app); await app.init();
  });
  beforeEach(() => {
    enabled = true; active = true; role = 'User'; profileExists = false; profileWrites = 0;
    missingEmail = false; unavailable = false; profileName = 'Khách hàng'; usedCodes.clear();
  });
  afterAll(async () => {
    await app?.close(); provider.closeAllConnections();
    await new Promise<void>(resolve => provider.close(() => resolve())); vi.unstubAllEnvs();
  });
  async function begin(next = '') {
    const result = await request(app.getHttpServer()).post('/api/auth/google').set('Origin', origin).send({ acceptTerms: true, next }).expect(200);
    const authorize = new URL(result.body.url);
    challenge = authorize.searchParams.get('code_challenge')!;
    const setCookie = (result.headers['set-cookie'] as unknown as string[]).find(value => value.startsWith('pose-google-flow='))!;
    return { authorize, setCookie, cookie: setCookie.split(';')[0] };
  }
  function callback(cookie: string, query = 'code=valid-code') {
    return request(app.getHttpServer()).get(`/api/auth/google/callback?${query}`).set('Cookie', cookie);
  }
  function flowCookie(flow: object) {
    const value = Buffer.from(JSON.stringify(flow)).toString('base64url');
    const mac = createHmac('sha256', secret).update(value).digest('base64url');
    return `pose-google-flow=${value}.${mac}`;
  }
  function expectNoSession(result: { headers: Record<string, unknown> }) {
    expect((result.headers['set-cookie'] as string[] || []).some(value => /^pose-(access|refresh)=[^;]/.test(value))).toBe(false);
  }
  it('creates S256 PKCE in an HttpOnly transaction and uses the public application callback', async () => {
    const result = await begin();
    expect(result.authorize.origin).toBe(providerUrl);
    expect(result.authorize.searchParams.get('provider')).toBe('google');
    expect(result.authorize.searchParams.get('code_challenge_method')).toBe('s256');
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.authorize.searchParams.get('redirect_to')).toBe(`${origin}/api/auth/google/callback`);
    expect(result.setCookie).toMatch(/HttpOnly/); expect(result.setCookie).toMatch(/Secure/);
    expect(result.setCookie).toMatch(/SameSite=lax/); expect(result.setCookie).toMatch(/Max-Age=600/);
    expect(result.authorize.searchParams.has('code_verifier')).toBe(false);
  });
  it('rejects forged origins, missing terms, unknown fields and external return URLs', async () => {
    await request(app.getHttpServer()).post('/api/auth/google').set('Origin', 'https://evil.example').send({ acceptTerms: true }).expect(403);
    await request(app.getHttpServer()).post('/api/auth/google').send({ acceptTerms: true }).expect(403);
    for (const body of [{ acceptTerms: false }, { acceptTerms: true, role: 'Admin' }, { acceptTerms: true, next: 'https://evil.example' }, { acceptTerms: true, next: '//evil.example' }]) {
      await request(app.getHttpServer()).post('/api/auth/google').set('Origin', origin).send(body).expect(400);
    }
    await request(app.getHttpServer()).get('/api/auth/google').expect(404);
  });
  it('reports disabled Google without creating a transaction', async () => {
    enabled = false;
    const result = await request(app.getHttpServer()).post('/api/auth/google').set('Origin', origin).send({ acceptTerms: true }).expect(503);
    expectNoSession(result); expect(result.body.message).toContain('email');
    expect(result.headers['set-cookie'].some((value: string) => value.startsWith('pose-google-flow='))).toBe(false);
  });
  it('verifies the JWT identity and creates the missing profile without trusting provider role metadata', async () => {
    const { cookie } = await begin();
    const result = await callback(cookie).expect(303);
    expect(result.headers.location).toBe(`${origin}/`);
    expect(profileWrites).toBe(1); expect(profileName).toBe('Khách Google');
    const credentials = (result.headers['set-cookie'] as unknown as string[]).filter(value => /^pose-(access|refresh)=google/.test(value));
    expect(credentials).toHaveLength(2); expect(credentials.every(value => /HttpOnly/.test(value) && /Secure/.test(value))).toBe(true);
    expect(result.headers['cache-control']).toBe('private, no-store');
    expect(result.headers['referrer-policy']).toBe('no-referrer');
    const sessionCookie = credentials.map(value => value.split(';')[0]).join('; ');
    await request(app.getHttpServer()).get('/api/auth/admin').set('Cookie', sessionCookie).expect(403);
    const me = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', sessionCookie).expect(200);
    expect(me.body.user.providers).toEqual(['google']); expect(JSON.stringify(me.body)).not.toContain('google-access');
  });
  it('preserves an existing profile and the authenticated user identity', async () => {
    profileExists = true; profileName = 'Tên khách đã sửa';
    const { cookie } = await begin(); await callback(cookie).expect(303);
    expect(profileWrites).toBe(0); expect(profileName).toBe('Tên khách đã sửa');
  });
  it('continues the inquiry draft only for a customer', async () => {
    const first = await begin('/customer/inquiries/new');
    expect((await callback(first.cookie)).headers.location).toBe(`${origin}/customer/inquiries/new`);
    usedCodes.clear(); role = 'Sales';
    const second = await begin('/customer/inquiries/new');
    expect((await callback(second.cookie)).headers.location).toBe(`${origin}/`);
  });
  it('uses the current server-managed role for Admin', async () => {
    role = 'Admin'; const { cookie } = await begin();
    expect((await callback(cookie)).headers.location).toBe(`${origin}/`);
  });
  it('rejects a callback without a transaction and a tampered or expired transaction', async () => {
    const { cookie } = await begin();
    for (const invalid of ['', `${cookie}x`, flowCookie({ verifier: 'a'.repeat(64), issuedAt: Date.now() - 601000, next: '' })]) {
      const result = await callback(invalid).expect(303);
      expect(result.headers.location).toBe(`${origin}/sign-in?oauth=expired`); expectNoSession(result);
    }
  });
  it('handles cancellation and invalid codes without exposing provider details', async () => {
    const first = await begin();
    const cancelled = await callback(first.cookie, 'error=access_denied&error_description=private-provider-detail').expect(303);
    expect(cancelled.headers.location).toBe(`${origin}/sign-in?oauth=cancelled`); expectNoSession(cancelled);
    const second = await begin();
    expect((await callback(second.cookie, 'code=invalid')).headers.location).toBe(`${origin}/sign-in?oauth=failed`);
  });
  it('rejects repeated authorization codes and codes from a different browser transaction', async () => {
    const first = await begin(); const second = await begin();
    const wrong = await callback(first.cookie).expect(303); expectNoSession(wrong);
    expect(wrong.headers.location).toBe(`${origin}/sign-in?oauth=failed`);
    await callback(second.cookie).expect(303);
    const replay = await callback(second.cookie).expect(303); expectNoSession(replay);
    expect(replay.headers.location).toBe(`${origin}/sign-in?oauth=failed`);
  });
  it('does not establish an app session for a suspended account or missing email', async () => {
    const first = await begin(); active = false;
    const blocked = await callback(first.cookie).expect(303); expectNoSession(blocked);
    expect(blocked.headers.location).toBe(`${origin}/sign-in?oauth=unavailable`); expect(profileWrites).toBe(0);
    active = true; usedCodes.clear(); missingEmail = true; const second = await begin();
    const incomplete = await callback(second.cookie).expect(303); expectNoSession(incomplete);
    expect(incomplete.headers.location).toBe(`${origin}/sign-in?oauth=failed`);
  });
  it('keeps an existing signed-in user on their own role home without changing identity', async () => {
    const result = await request(app.getHttpServer()).post('/api/auth/google').set('Origin', origin).set('Cookie', 'pose-access=google-access').send({ acceptTerms: true }).expect(200);
    expect(result.body.url).toBe('/'); expect(result.headers['set-cookie']).toBeUndefined();
  });
  it('limits repeated Google starts from the same client address', async () => {
    let limited = false;
    for (let index = 0; index < 31; index++) {
      const result = await request(app.getHttpServer()).post('/api/auth/google').set('Origin', origin).send({ acceptTerms: true });
      if (result.status === 429) { limited = true; expect(result.body.message).toContain('15 phút'); break; }
      expect(result.status).toBe(200);
    }
    expect(limited).toBe(true);
  });
});
