import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
describe('Lead reporting HTTP access', () => {
  let app: INestApplication,
    provider: Server,
    role = 'Admin',
    allowed = true;
  let failure: { code: string; message: string } | null = null;
  const id = '00000000-0000-4000-8000-000000000001';
  const calls: { path: string; body: Record<string, unknown>; authorization?: string }[] = [];
  beforeAll(async () => {
    provider = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const path = new URL(req.url!, 'http://localhost').pathname;
      const reply = (status: number, data: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (path.endsWith('/user'))
        return req.headers.authorization === 'Bearer valid'
          ? reply(200, { id, email: 'staff@example.test', email_confirmed_at: '2020-01-01' })
          : reply(401, {});
      if (path.endsWith('/pose_access_context'))
        return reply(200, { user_id: id, role, active: allowed, session_valid: allowed });
      calls.push({ path, body: raw ? JSON.parse(raw) : {}, authorization: req.headers.authorization });
      return failure
        ? reply(400, failure)
        : reply(200, { stats: { total: 0, converted: 0 }, statuses: [], temperatures: [], trend: [], scope: { role } });
    });
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:' + (provider.address() as AddressInfo).port);
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'fixture');
    vi.stubEnv('LEAD_ROUTING_ENABLED', 'false');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
  });
  beforeEach(() => {
    role = 'Admin';
    allowed = true;
    failure = null;
    calls.length = 0;
  });
  afterAll(async () => {
    await app?.close();
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    vi.unstubAllEnvs();
  });
  const get = (path = '/api/reports/leads') =>
    request(app.getHttpServer()).get(path).set('Cookie', 'pose-access=valid');
  it('denies unauthenticated, customer and revoked staff sessions', async () => {
    await request(app.getHttpServer()).get('/api/reports/leads').expect(401);
    role = 'User';
    await get().expect(403);
    await get('/api/reports/options').expect(403);
    role = 'Sales';
    allowed = false;
    await get().expect(401);
    expect(calls).toHaveLength(0);
  });
  it('uses the staff token and normalized filters, never the system key', async () => {
    const response = await get(
      '/api/reports/leads?date_from=2025-01-01&date_to=2025-01-31&archived=all&sales_id=' + id,
    ).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(calls[0]).toEqual({
      path: '/rest/v1/rpc/pose_report_leads',
      authorization: 'Bearer valid',
      body: { p_filters: { date_from: '2025-01-01', date_to: '2025-01-31', archived: 'all', sales_id: id } },
    });
  });
  it('rejects Sales ownership overrides before business RPCs', async () => {
    role = 'Sales';
    await get('/api/reports/leads?sales_id=' + id).expect(403);
    expect(calls).toHaveLength(0);
    await get('/api/reports/leads?archived=true').expect(200);
    expect(calls[0].body).toHaveProperty('p_filters.archived', 'true');
  });
  it('rejects duplicate filters, fake score writes and unsupported pagination', async () => {
    for (const query of [
      'status=NEW&status=LOST',
      'lead_score=99',
      'pageSize=10000',
      'date_from=2025-02-30&date_to=2025-03-01',
    ])
      await get('/api/reports/leads?' + query).expect(400);
    await get('/api/reports/options?sales_id=' + id).expect(400);
    expect(calls).toHaveLength(0);
  });
  it('preserves DB authorization checks and reports missing migration clearly', async () => {
    failure = { code: '42501', message: 'REPORT_FORBIDDEN' };
    await get().expect(403);
    failure = { code: '42883', message: 'missing function' };
    const response = await get().expect(503);
    expect(response.body.code).toBe('REPORT_NOT_READY');
  });
  it('registers options and exposes no business mutations or export endpoint', async () => {
    await get('/api/reports/options').expect(200);
    expect(calls[0].path).toBe('/rest/v1/rpc/pose_report_options');
    await request(app.getHttpServer())
      .post('/api/reports/leads')
      .set('Cookie', 'pose-access=valid')
      .send({ status: 'CONVERTED' })
      .expect(404);
    await get('/api/reports/export').expect(404);
  });
});
