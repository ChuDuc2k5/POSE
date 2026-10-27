import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
describe('Sales HTTP authorization', () => {
  let app: INestApplication,
    provider: Server,
    role = 'Sales',
    dbError: { code: string; message: string } | null = null;
  const calls: { path: string; body: Record<string, unknown>; authorization?: string }[] = [];
  const id = '00000000-0000-4000-8000-000000000001';
  beforeAll(async () => {
    provider = createServer(async (req, res) => {
      let raw = '';
      for await (const c of req) raw += c;
      const path = new URL(req.url!, 'http://localhost').pathname;
      const reply = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (path.endsWith('/user'))
        return req.headers.authorization === 'Bearer valid'
          ? reply(200, { id, email: 'sales@example.test', email_confirmed_at: '2026-01-01' })
          : reply(401, {});
      if (path.endsWith('/pose_access_context'))
        return reply(200, { user_id: id, role, active: true, session_valid: true });
      calls.push({ path, body: raw ? JSON.parse(raw) : {}, authorization: req.headers.authorization });
      return dbError ? reply(400, dbError) : reply(200, { items: [], total: 0 });
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
    role = 'Sales';
    dbError = null;
    calls.length = 0;
  });
  afterAll(async () => {
    await app?.close();
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    vi.unstubAllEnvs();
  });
  const mutate = (data: object) =>
    request(app.getHttpServer())
      .patch('/api/sales/leads/' + id)
      .set('Cookie', 'pose-access=valid')
      .set('Origin', 'http://localhost:3000')
      .send(data);
  it('rejects unauthenticated, customer, admin write and invalid origin requests', async () => {
    await request(app.getHttpServer()).get('/api/sales/leads').expect(401);
    role = 'User';
    await request(app.getHttpServer()).get('/api/sales/properties').set('Cookie', 'pose-access=valid').expect(403);
    role = 'Admin';
    await mutate({ version: 0, action: 'result', reason: 'Kết quả tư vấn', data: { status: 'CONTACTED' } }).expect(403);
    role = 'Sales';
    await request(app.getHttpServer())
      .patch('/api/sales/leads/' + id)
      .set('Cookie', 'pose-access=valid')
      .set('Origin', 'https://other.test')
      .send({})
      .expect(403);
    expect(calls).toHaveLength(0);
  });
  it('forwards the session token and allows only admin to filter another Sales', async () => {
    await request(app.getHttpServer())
      .get('/api/sales/properties?sales_id=' + id)
      .set('Cookie', 'pose-access=valid')
      .expect(403);
    role = 'Admin';
    await request(app.getHttpServer())
      .get('/api/sales/properties?sales_id=' + id)
      .set('Cookie', 'pose-access=valid')
      .expect(200);
    expect(calls[0]).toMatchObject({
      authorization: 'Bearer valid',
      body: { p_filters: { sales_id: id }, p_page: 1, p_size: 12 },
    });
  });
  it('rejects score/transfer fields before calling database', async () => {
    await mutate({
      version: 0,
      action: 'result',
      reason: 'Khách xác nhận',
      data: { status: 'QUALIFIED', lead_score: 100 },
    }).expect(400);
    await mutate({ version: 0, action: 'assign', reason: 'Giao Sales', data: { sales_id: id } }).expect(400);
    expect(calls).toHaveLength(0);
  });
  it('preserves ownership, terminal lock and concurrent-update errors from DB', async () => {
    const body = { version: 3, action: 'result', reason: 'Khách xác nhận', data: { status: 'QUALIFIED' } };
    for (const [code, message, status] of [
      ['42501', 'SALES_PROPERTY_FORBIDDEN', 403],
      ['22023', 'SALES_LEAD_LOCKED', 409],
      ['40001', 'SALES_VERSION_CONFLICT', 409],
    ] as const) {
      dbError = { code, message };
      await mutate(body).expect(status);
    }
    expect(calls[0].body).toEqual({
      p_lead: id,
      p_version: 3,
      p_action: 'result',
      p_data: { status: 'QUALIFIED' },
      p_reason: 'Khách xác nhận',
    });
  });
  it('enforces property ownership before reading storage and exposes no property mutations', async () => {
    dbError = { code: '42501', message: 'SALES_PROPERTY_FORBIDDEN' };
    await request(app.getHttpServer())
      .get('/api/sales/media/' + id)
      .set('Cookie', 'pose-access=valid')
      .expect(403);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/rest/v1/rpc/pose_sales_media');
    await request(app.getHttpServer())
      .patch('/api/sales/properties/' + id)
      .set('Cookie', 'pose-access=valid')
      .send({ price: 1 })
      .expect(404);
  });
});
