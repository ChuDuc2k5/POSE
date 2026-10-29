import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
describe('Manual appointment HTTP access', () => {
  let app: INestApplication,
    provider: Server,
    role = 'Admin',
    allowed = true;
  let failure: { code: string; message: string } | null = null;
  const id = '00000000-0000-4000-8000-000000000001',
    origin = 'http://localhost:3000';
  const calls: { path: string; body: Record<string, unknown>; authorization?: string }[] = [];
  beforeAll(async () => {
    provider = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const path = new URL(req.url!, 'http://localhost').pathname;
      const reply = (status: number, value: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      if (path.endsWith('/user'))
        return req.headers.authorization === 'Bearer valid'
          ? reply(200, { id, email: 'staff@example.test', email_confirmed_at: '2020-01-01' })
          : reply(401, {});
      if (path.endsWith('/pose_access_context'))
        return reply(200, { user_id: id, role, active: allowed, session_valid: allowed });
      calls.push({ path, body: raw ? JSON.parse(raw) : {}, authorization: req.headers.authorization });
      return failure ? reply(400, failure) : reply(200, { item: { id }, items: [], total: 0, role });
    });
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:' + (provider.address() as AddressInfo).port);
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'fixture');
    vi.stubEnv('LEAD_ROUTING_ENABLED', 'false');
    vi.stubEnv('FRONTEND_URL', origin);
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
  const get = (path = '/api/appointments') => request(app.getHttpServer()).get(path).set('Cookie', 'pose-access=valid');
  const patch = (body: object, requestOrigin = origin) =>
    request(app.getHttpServer())
      .patch('/api/appointments/' + id)
      .set('Cookie', 'pose-access=valid')
      .set('Origin', requestOrigin)
      .send(body);
  it('denies missing, customer and revoked accounts before business reads', async () => {
    await request(app.getHttpServer()).get('/api/appointments').expect(401);
    role = 'User';
    await get().expect(403);
    role = 'Sales';
    allowed = false;
    await get().expect(401);
    expect(calls).toHaveLength(0);
  });
  it('passes the authenticated token and only appointment list filters', async () => {
    const r = await get('/api/appointments?date_from=2027-01-01&status=SCHEDULED&page=2').expect(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(calls[0]).toEqual({
      path: '/rest/v1/rpc/pose_appointment_list',
      authorization: 'Bearer valid',
      body: { p_filters: { date_from: '2027-01-01', status: 'SCHEDULED' }, p_page: 2, p_size: 12 },
    });
  });
  it('denies forged Sales scope and privileged correction', async () => {
    role = 'Sales';
    await get('/api/appointments?sales_id=' + id).expect(403);
    await get('/api/appointments/options?kind=sales').expect(403);
    expect(calls).toHaveLength(0);
    await patch({ action: 'cancel', version: 0, data: {}, reason: 'Khách bận' }).expect(200);
    expect(calls[0].body.p_action).toBe('cancel');
  });
  it('requires trusted write origin and reasons for administrative changes', async () => {
    const body = { action: 'cancel', version: 0, data: {}, reason: 'Khách bận' };
    await patch(body, 'https://untrusted.example').expect(403);
    await patch({ action: 'complete', version: 0, data: { result: 'Đã gặp khách' } }).expect(400);
    expect(calls).toHaveLength(0);
  });
  it('accepts create and preserves the request key without accepting a Sales override', async () => {
    const data = {
      lead_id: id,
      request_key: id,
      title: 'Tư vấn căn hộ',
      starts_at: '2027-01-01T09:00:00+07:00',
      ends_at: '2027-01-01T10:00:00+07:00',
      channel: 'Phone',
      location: '',
      notes: '',
      property_id: null,
    };
    await request(app.getHttpServer())
      .post('/api/appointments')
      .set('Cookie', 'pose-access=valid')
      .set('Origin', origin)
      .send({ data })
      .expect(200);
    expect(calls[0].body).toEqual({ p_id: null, p_version: null, p_action: 'create', p_data: data, p_reason: '' });
    await request(app.getHttpServer())
      .post('/api/appointments')
      .set('Cookie', 'pose-access=valid')
      .set('Origin', origin)
      .send({ data: { ...data, sales_id: id }, reason: 'Admin phân công' })
      .expect(200);
  });
  it('maps overlap, locked Lead, stale version and missing migration clearly', async () => {
    for (const [code, message, expected, status] of [
      ['23P01', 'APPOINTMENT_OVERLAP', 'APPOINTMENT_OVERLAP', 409],
      ['55000', 'APPOINTMENT_LEAD_LOCKED', 'LEAD_LOCKED', 409],
      ['55000', 'APPOINTMENT_INCOMPLETE', 'APPOINTMENT_INCOMPLETE', 409],
      ['40001', 'VERSION_CONFLICT', 'VERSION_CONFLICT', 409],
      ['42883', 'missing function', 'APPOINTMENTS_NOT_READY', 503],
    ] as const) {
      failure = { code, message };
      const response = await patch({ action: 'cancel', version: 0, data: {}, reason: 'Khách đổi lịch' }).expect(status);
      expect(response.body.code).toBe(expected);
    }
  });
  it('registers detail/options and has no reminder, deletion or chatbot sync action', async () => {
    await get('/api/appointments/' + id).expect(200);
    await get('/api/appointments/options?kind=properties&lead_id=' + id).expect(200);
    expect(calls.map((c) => c.path)).toEqual([
      '/rest/v1/rpc/pose_appointment_detail',
      '/rest/v1/rpc/pose_appointment_options',
    ]);
    await patch({ action: 'sync_chatbot', version: 0, data: {}, reason: 'Không hỗ trợ' }).expect(400);
    await request(app.getHttpServer())
      .delete('/api/appointments/' + id)
      .set('Cookie', 'pose-access=valid')
      .expect(404);
  });
});
