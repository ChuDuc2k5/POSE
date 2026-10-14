import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { CampaignsScheduler, cronAuthorized } from '../src/modules/campaigns/campaigns.scheduler.js';
import { campaignErrors, filterErrors } from '../src/modules/campaigns/validation.js';
import { defaultScript, scriptErrors } from '../src/modules/campaigns/script.js';
import { telephonyConfigured } from '../src/common/telephony.js';

const id = 'f7900000-0000-4000-8000-000000000001';
const cron = 'campaign-test-secret-with-at-least-32-characters';
describe('campaign contracts and authenticated realtime', () => {
  let app: INestApplication, scheduler: CampaignsScheduler;
  let role = 'Admin', failure = false;
  const sockets: WebSocket[] = [];
  beforeEach(async () => {
    role = 'Admin'; failure = false;
    vi.stubEnv('SUPABASE_URL', 'https://provider.example');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'public-fixture');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'service-fixture');
    vi.stubEnv('CRON_SECRET', cron);
    for (const key of ['TELEPHONY_PROVIDER','TELEPHONY_API_URL','TELEPHONY_API_KEY','TELEPHONY_CALLER_ID','TELEPHONY_WEBHOOK_SECRET']) vi.stubEnv(key, 'fixture');
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const token = new Headers(init?.headers).get('Authorization');
      const currentRole = token === 'Bearer sales-token' ? 'Sales' : role;
      if (url.endsWith('/user')) return Response.json({ id, email_confirmed_at: '2026-10-01' });
      if (url.endsWith('/pose_access_context')) return Response.json({ user_id: id, role: currentRole, active: true, session_valid: true });
      if (url.endsWith('/pose_system_campaign_tick')) return failure ? Response.json({ code: '22023', message: 'INVALID_TIME' }, { status: 400 }) : Response.json({ jobs_created: 1, _changed_campaigns: [id] });
      if (url.endsWith('/pose_save_campaign')) return Response.json({ id, status: 'DRAFT', version: 0 });
      return Response.json([{ id, name: 'Chiến dịch', status: 'DRAFT' }], { headers: { 'content-range': '0-0/1' } });
    }));
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ bodyParser: false }); configureApp(app);
    await app.listen(0, '127.0.0.1'); scheduler = app.get(CampaignsScheduler);
  });
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await app?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  });
  const admin = (method: 'get' | 'post' | 'patch', path = '') => request(app.getHttpServer())[method]('/api/admin/campaigns' + path).set('Authorization', 'Bearer admin-token');
  it('enforces anonymous, Sales and User denials, mutation origins and no-store', async () => {
    await request(app.getHttpServer()).get('/api/admin/campaigns').expect(401);
    for (const value of ['Sales', 'User']) { role = value; await admin('get').expect(403); await admin('get', '/scheduler').expect(403); }
    role = 'Admin';
    await admin('post').set('Origin', 'https://other.example').send({ name: 'Campaign', version: 0 }).expect(403);
    const response = await admin('get').expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ items: [{ id, name: 'Chiến dịch', status: 'DRAFT' }], total: 1, page: 1 });
  });
  it('preserves create/validation/error DTOs and the exact scheduler status shape', async () => {
    const invalid = await admin('post').set('Origin', 'http://localhost:3000').send({ name: 'Campaign', version: 0, max_concurrent_calls: 3 }).expect(400);
    expect(invalid.body).toMatchObject({ code: 'VALIDATION_FAILED', field_errors: { max_concurrent_calls: expect.any(String) }, correlation_id: expect.any(String) });
    await admin('post').set('Origin', 'http://localhost:3000').send({ name: 'Campaign', version: 0 }).expect(201).expect({ item: { id, status: 'DRAFT', version: 0 } });
    const response = await admin('get', '/scheduler').expect(200);
    expect(response.body).toEqual({ redis: false, repeatEvery: 60000, lastRunAt: null, lastResult: null, lastError: null });
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('uses constant-time cron validation and keeps manual ticks working without Redis', async () => {
    expect(cronAuthorized(null)).toBe(false); expect(cronAuthorized('Bearer wrong')).toBe(false);
    await request(app.getHttpServer()).post('/api/system/campaigns/tick').expect(401);
    await request(app.getHttpServer()).post('/api/system/campaigns/tick').set('Authorization', 'Bearer ' + cron).expect(200).expect({ item: { jobs_created: 1 } });
    expect(scheduler.status()).toMatchObject({ redis: false, lastResult: { jobs_created: 1 }, lastError: null });
    failure = true;
    await request(app.getHttpServer()).post('/api/system/campaigns/tick').set('Authorization', 'Bearer ' + cron).expect(400);
    expect(scheduler.status().lastError).toBe('INVALID_TIME');
    vi.stubEnv('TELEPHONY_API_KEY', ''); expect(telephonyConfigured()).toBe(false);
    await request(app.getHttpServer()).post('/api/system/campaigns/tick').set('Authorization', 'Bearer ' + cron).expect(503);
  });
  it('validates audience limits, script consent/disclosure and call units', () => {
    expect(filterErrors({ lead_ids: Array(501).fill(id) })).toHaveProperty('filter');
    expect(campaignErrors({ version: 0, max_call_seconds: 29, retry_after_hours: 23, budget_limit_vnd: 0 })).toHaveProperty('max_call_seconds');
    expect(scriptErrors(defaultScript)).toEqual({});
    expect(scriptErrors({ ...defaultScript, ai_disclosure: 'Tôi là tư vấn viên' })).toHaveProperty('ai_disclosure');
    expect(scriptErrors({ ...defaultScript, consent_prompt: { ...defaultScript.consent_prompt, recording: '' } })).toHaveProperty('consent_prompt.recording');
  });
  async function socket(token: string) {
    const address = app.getHttpServer().address() as AddressInfo;
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/socket.io?EIO=4&transport=websocket`); sockets.push(ws);
    const events: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Socket authentication timed out')), 3000);
      ws.onerror = () => { clearTimeout(timer); reject(Error('Socket failed')); };
      ws.onmessage = event => {
        const frame = String(event.data);
        if (frame.startsWith('0')) ws.send('40' + JSON.stringify({ token }));
        else if (frame.startsWith('40')) { clearTimeout(timer); resolve(); }
        else if (frame.startsWith('44')) { clearTimeout(timer); reject(Error(frame)); }
        else if (frame === '2') ws.send('3');
        else if (frame.startsWith('42')) events.push(JSON.parse(frame.slice(2)));
      };
    });
    return events;
  }
  it('delivers campaign.progress to an Admin socket after a tick, never to Sales, and rechecks downgrade', async () => {
    const adminEvents = await socket('admin-token'), salesEvents = await socket('sales-token');
    await scheduler.tick();
    await vi.waitFor(() => expect(adminEvents).toEqual([['campaign.progress', { campaignIds: [id] }]]));
    expect(salesEvents).toEqual([]);
    role = 'User'; await scheduler.tick();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(adminEvents).toHaveLength(1); expect(salesEvents).toEqual([]);
  });
});
