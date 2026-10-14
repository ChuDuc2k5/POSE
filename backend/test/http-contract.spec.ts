import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import request from 'supertest';
import type { Server as SocketServer, Socket } from 'socket.io';
import { GatewayGateway } from '../src/gateway/gateway.gateway.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { clientIp } from '../src/common/http.js';
import { validateCatalog } from '../src/common/catalog.js';
import { inquiryInput, searchParameters } from '../src/common/discovery.js';

describe('NestJS HTTP session and validation contracts', () => {
  let app: INestApplication;
  let provider: Server;
  let active = true, offline = false, role = 'User';
  const user = { id: '00000000-0000-4000-8000-000000000001', email: 'user@example.test', email_confirmed_at: '2026-10-01', aud: 'authenticated' };
  beforeAll(async () => {
    provider = createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const url = new URL(req.url!, 'http://localhost');
      const reply = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (offline) return reply(503, { message: 'offline' });
      if (url.pathname.endsWith('/user')) return req.headers.authorization === 'Bearer valid' ? reply(200, user) : reply(401, { msg: 'invalid' });
      if (url.pathname.endsWith('/token')) return JSON.parse(raw).refresh_token === 'renew' ? reply(200, { access_token: 'valid', refresh_token: 'renew', expires_in: 3600, token_type: 'bearer', user }) : reply(400, { msg: 'invalid' });
      if (url.pathname.endsWith('/pose_access_context')) return reply(200, { user_id: user.id, role, active, session_valid: active });
      return reply(404, {});
    });
    await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
    vi.stubEnv('SUPABASE_URL', `http://127.0.0.1:${(provider.address() as AddressInfo).port}`);
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'fixture');
    vi.stubEnv('FRONTEND_URL', 'https://web.example,http://localhost:3000');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
  });
  beforeEach(() => { active = true; offline = false; role = 'User'; });
  afterAll(async () => {
    await app?.close();
    provider.closeAllConnections();
    await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
    vi.unstubAllEnvs();
  });
  it('uses one verified session for cookie and bearer callers without exposing tokens', async () => {
    for (const [header, value] of [['Cookie','pose-access=valid'], ['Authorization','Bearer valid']]) {
      const result = await request(app.getHttpServer()).get('/api/auth/session?writable=false').set(header, value).expect(200);
      expect(result.body.role).toBe('User');
      expect(result.body.user.id).toBe(user.id);
      expect(JSON.stringify(result.body)).not.toContain('access_token');
      expect(result.headers['cache-control']).toBe('no-store');
    }
  });
  it('refreshes cookies through both session endpoint and guard', async () => {
    for (const path of ['/api/auth/session', '/api/auth/principal']) {
      const result = await request(app.getHttpServer()).get(path).set('Cookie','pose-refresh=renew').expect(200);
      expect(result.headers['set-cookie']).toHaveLength(2);
      expect((result.headers['set-cookie'] as unknown as string[]).join(';')).toContain('HttpOnly');
    }
    const readonly = await request(app.getHttpServer()).get('/api/auth/session?writable=false').set('Cookie','pose-refresh=renew').expect(200);
    expect(readonly.body).toBeNull();
    expect(readonly.headers['set-cookie']).toBeUndefined();
  });
  it('rejects forged, revoked and downgraded identities', async () => {
    await request(app.getHttpServer()).get('/api/auth/principal').set('Cookie','pose-access=forged').expect(401);
    active = false;
    await request(app.getHttpServer()).get('/api/auth/principal').set('Cookie','pose-access=valid').expect(401);
    active = true; role = 'Admin';
    await request(app.getHttpServer()).get('/api/auth/admin').set('Cookie','pose-access=valid').expect(200);
    role = 'User';
    await request(app.getHttpServer()).get('/api/auth/admin').set('Cookie','pose-access=valid').expect(403);
  });
  it('keeps cookies on outages and returns the shared error envelope', async () => {
    offline = true;
    const result = await request(app.getHttpServer()).get('/api/auth/principal').set('Cookie','pose-access=valid').expect(503);
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(result.body).toMatchObject({ code: 'UNAVAILABLE', field_errors: {} });
    expect(result.body.message).toBe('Dịch vụ xác thực chưa khả dụng.');
    expect(result.body.correlation_id).toMatch(/^[a-f0-9-]{36}$/);
  });
  it('checks configured web origins before every module mutation', async () => {
    for (const [method,path] of [['post','/api/auth/signin'],['patch','/api/account/profile'],['post','/api/admin/catalog/projects'],['put',`/api/customer/favorites/${user.id}`]] as const) {
      const call = request(app.getHttpServer())[method](path);
      const result = await call.set('Origin','https://evil.example').send({}).expect(403);
      expect(result.headers['cache-control']).toBe('no-store');
    }
    await request(app.getHttpServer()).post('/api/auth/signin').set('Origin','https://web.example').send({}).expect(400);
    await request(app.getHttpServer()).post('/api/auth/signin').send({}).expect(403);
  });
  it('validates each module before issuing business RPCs', async () => {
    await request(app.getHttpServer()).post('/api/auth/signin').set('Origin','https://web.example').send({ email: 'invalid' }).expect(400);
    await request(app.getHttpServer()).patch('/api/account/profile').set('Origin','https://web.example').set('Cookie','pose-access=valid').send({ role: 'Admin' }).expect(400);
    role = 'Admin';
    const catalog = await request(app.getHttpServer()).post('/api/admin/catalog/projects').set('Origin','https://web.example').set('Cookie','pose-access=valid').send({ actor_id: user.id }).expect(400);
    expect(catalog.body.field_errors.form).toBeDefined();
    role = 'User';
    await request(app.getHttpServer()).post('/api/customer/inquiries').set('Origin','https://web.example').set('Cookie','pose-access=valid').send({ user_id: user.id }).expect(400);
    await request(app.getHttpServer()).get('/api/workspace/other').expect(404);
    await request(app.getHttpServer()).get('/api/workspace/admin').set('Cookie','pose-access=valid').expect(403);
    role = 'Admin';
    const workspace = await request(app.getHttpServer()).get('/api/workspace/admin').set('Cookie','pose-access=valid').expect(200);
    expect(workspace.body.message).toBe('Bạn có quyền truy cập không gian quản trị.');
  });
  it('keeps callback paths outside the api prefix and disables queues without Redis', async () => {
    await request(app.getHttpServer()).get('/auth/confirm?token_hash=bad&type=email').expect(307);
    const health = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(health.body).toEqual({ ok: true, supabase: true, redis: false });
  });
  it('handles authenticated websocket messages through the global guard and disconnects revoked sessions', async () => {
    await app.listen(0, '127.0.0.1');
    const port = ((app.getHttpServer() as Server).address() as AddressInfo).port;
    for (const authorized of [true, false]) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/socket.io?EIO=4&transport=websocket`);
      try {
        await new Promise<void>((resolve, reject) => {
          let received = false;
          const timeout = setTimeout(() => reject(new Error('Socket did not finish')), 3000);
          const finish = (error?: Error) => { clearTimeout(timeout); if (error) reject(error); else resolve(); };
          socket.onerror = () => finish(new Error('Socket transport failed'));
          socket.onclose = () => received ? finish() : finish(new Error('Socket closed before authorization'));
          socket.onmessage = event => {
            const frame = String(event.data);
            try {
              if (frame.startsWith('0')) socket.send('40' + JSON.stringify(authorized ? { token: 'valid' } : {}));
              else if (frame.startsWith('40')) socket.send('42' + JSON.stringify(['message', {}]));
              else if (frame.startsWith('44')) { expect(authorized).toBe(false); finish(); }
              else if (frame.startsWith('42')) {
                expect(authorized).toBe(true);
                expect(JSON.parse(frame.slice(2))).toEqual(['message', { message: 'Hello from NestJS Backend!' }]);
                received = true;
                active = false;
                socket.send('42' + JSON.stringify(['message', {}]));
              }
            } catch (error) { finish(error as Error); }
          };
        });
      } finally { socket.close(); active = true; }
    }
  });
  it('authenticates socket cookies and bearer tokens with the same role checks', async () => {
    const gateway = app.get(GatewayGateway);
    let middleware: (client: Socket, next: (error?: Error) => void) => Promise<void>;
    gateway.afterInit({ use: (callback: typeof middleware) => { middleware = callback; } } as unknown as SocketServer);
    for (const credentials of [{ cookie: 'pose-access=valid' }, { token: 'valid' }]) {
      const emit = vi.fn(), disconnect = vi.fn();
      const client = { handshake: { headers: { origin: 'https://web.example', ...('cookie' in credentials ? { cookie: credentials.cookie } : {}) }, auth: 'token' in credentials ? credentials : {} }, data: {}, emit, disconnect } as unknown as Socket;
      const next = vi.fn();
      await middleware!(client, next);
      expect(next).toHaveBeenCalledWith();
      expect(client.data.principal).toEqual({ id: user.id, role: 'User' });
      await gateway.handleMessage(client, {});
      expect(emit).toHaveBeenCalledWith('message', { message: 'Hello from NestJS Backend!' });
      role = 'Sales';
      await gateway.handleMessage(client, {});
      expect(disconnect).toHaveBeenCalledWith(true);
      role = 'User';
    }
    for (const headers of [{ origin: 'https://evil.example', cookie: 'pose-access=valid' }, { origin: 'https://web.example', cookie: 'pose-access=forged' }, { origin: 'https://web.example' }]) {
      const next = vi.fn();
      await middleware!({ handshake: { headers, auth: {} }, data: {} } as unknown as Socket, next);
      expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    }
  });
  it('trusts only the last forwarded IP from an explicitly trusted proxy', () => {
    const req = (remoteAddress: string) => ({ headers: { 'x-forwarded-for': 'spoofed,198.51.100.2' }, socket: { remoteAddress } }) as unknown as Request;
    expect(clientIp(req('127.0.0.1'))).toBe('198.51.100.2');
    expect(clientIp(req('198.51.100.3'))).toBe('198.51.100.3');
  });
  it('validates publication, search filters and independent consent purposes', () => {
    expect(validateCatalog('properties', { name: 'Home', area: 0, price: Infinity, version: -1 }).area).toBeDefined();
    expect(searchParameters(new URLSearchParams('q=one&q=two')).fields.form).toBeDefined();
    const input = { property_id: null, name: 'Customer', phone: '0912345678', country: 'VN', channel: 'Phone', preferred_time: '', message: 'Need a new apartment', request_key: user.id, consent: { contact: true, call: false, ai: false, transcript: false, recording: false } };
    expect(inquiryInput(input).fields.channel).toBeDefined();
    expect(inquiryInput({ ...input, channel: 'Email' }).fields).toEqual({});
  });
});
