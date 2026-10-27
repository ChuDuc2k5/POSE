import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';

describe('M04 HTTP authorization and RPC forwarding', () => {
  let app: INestApplication, provider: Server;
  let role = 'Admin',
    allowed = true;
  const calls: { path: string; body: Record<string, unknown>; authorization?: string }[] = [];
  const id = '00000000-0000-4000-8000-000000000001';
  beforeAll(async () => {
    provider = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const path = new URL(req.url!, 'http://localhost').pathname;
      const reply = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (path.endsWith('/user'))
        return req.headers.authorization === 'Bearer valid'
          ? reply(200, { id, email: 'staff@example.test', email_confirmed_at: '2026-10-01' })
          : reply(401, {});
      if (path.endsWith('/pose_access_context'))
        return reply(200, { user_id: id, role, active: allowed, session_valid: allowed });
      calls.push({ path, body: raw ? JSON.parse(raw) : {}, authorization: req.headers.authorization });
      if (path.endsWith('/pose_lead_detail') && role === 'Sales')
        return reply(403, { code: '42501', message: 'LEAD_FORBIDDEN' });
      return reply(200, { items: [], total: 0, page: 1, pageSize: 12, stats: { total: 0 }, queued: 0 });
    });
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:' + (provider.address() as AddressInfo).port);
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'fixture');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
  });
  beforeEach(() => {
    role = 'Admin';
    allowed = true;
    calls.length = 0;
  });
  afterAll(async () => {
    await app?.close();
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    vi.unstubAllEnvs();
  });
  it('rejects non-staff and invalid origins before business RPCs', async () => {
    await request(app.getHttpServer()).get('/api/leads').expect(401);
    role = 'User';
    await request(app.getHttpServer()).get('/api/leads').set('Cookie', 'pose-access=valid').expect(403);
    role = 'Admin';
    await request(app.getHttpServer())
      .post('/api/leads/recheck')
      .set('Cookie', 'pose-access=valid')
      .set('Origin', 'https://untrusted.example')
      .send({})
      .expect(403);
    expect(calls).toHaveLength(0);
  });
  it('uses the staff access token rather than a system key', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/leads?temperature=HOT')
      .set('Cookie', 'pose-access=valid')
      .expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(calls[0]).toMatchObject({
      authorization: 'Bearer valid',
      body: { p_filters: { temperature: 'HOT' }, p_page: 1, p_size: 12 },
    });
  });
  it('enforces admin-only ownership and recheck APIs', async () => {
    role = 'Sales';
    await request(app.getHttpServer()).get('/api/leads/property-owners').set('Cookie', 'pose-access=valid').expect(403);
    await request(app.getHttpServer())
      .post('/api/leads/recheck')
      .set('Cookie', 'pose-access=valid')
      .set('Origin', 'http://localhost:3000')
      .send({})
      .expect(403);
    expect(calls).toHaveLength(0);
  });
  it('preserves database ownership checks and rejects score writes', async () => {
    role = 'Sales';
    await request(app.getHttpServer())
      .get('/api/leads/' + id)
      .set('Cookie', 'pose-access=valid')
      .expect(403);
    calls.length = 0;
    await request(app.getHttpServer())
      .patch('/api/leads/' + id)
      .set('Cookie', 'pose-access=valid')
      .set('Origin', 'http://localhost:3000')
      .send({ action: 'profile', version: 0, reason: 'Cập nhật', data: { lead_score: 100 } })
      .expect(400);
    expect(calls).toHaveLength(0);
  });
  it('forwards only validated mutation data and rechecks account revocation', async () => {
    await request(app.getHttpServer())
      .patch('/api/leads/' + id)
      .set('Cookie', 'pose-access=valid')
      .set('Origin', 'http://localhost:3000')
      .send({ action: 'status', version: 5, reason: 'Khách hẹn gọi lại', data: { status: 'FOLLOW_UP' } })
      .expect(200);
    expect(calls[0].body).toEqual({
      p_lead: id,
      p_version: 5,
      p_action: 'status',
      p_data: { status: 'FOLLOW_UP' },
      p_reason: 'Khách hẹn gọi lại',
    });
    allowed = false;
    await request(app.getHttpServer()).get('/api/leads').set('Cookie', 'pose-access=valid').expect(401);
  });
  it('rejects transfer and approval requests without forwarding business RPCs', async () => {
    for (const action of ['request_transfer', 'approve_transfer', 'reject_transfer']) {
      await request(app.getHttpServer())
        .patch('/api/leads/' + id)
        .set('Cookie', 'pose-access=valid')
        .set('Origin', 'http://localhost:3000')
        .send({ action, version: 0, reason: 'Chuyển người phụ trách', data: {} })
        .expect(400);
    }
    expect(calls).toHaveLength(0);
  });
});
