import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import request from 'supertest';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { QueueStatus, queueConnection } from '../src/modules/queue/queue.module.js';
import { CampaignsScheduler, repeatEvery, tickJobId } from '../src/modules/campaigns/campaigns.scheduler.js';

const redis = new Redis({ host: '127.0.0.1', port: 6379, lazyConnect: true, connectTimeout: 500, retryStrategy: () => null, maxRetriesPerRequest: 0 });
redis.on('error', () => {});
let reachable = false;
try { await redis.connect(); reachable = (await redis.ping()) === 'PONG'; } catch { /* Explicit optional integration. */ }
finally { redis.disconnect(); }
if (!reachable) console.log('SKIP: M07 real Redis integration; 127.0.0.1:6379 is not reachable.');

describe.skipIf(!reachable)('campaigns real Redis scheduling', () => {
  let app: INestApplication | undefined, queue: Queue;
  let failing = false;
  const name = `campaigns-test-${process.pid}-${Date.now()}`;
  beforeAll(() => {
    vi.stubEnv('CAMPAIGNS_QUEUE_NAME', name);
    vi.stubEnv('SUPABASE_URL', 'https://provider.example');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'public-fixture');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'service-fixture');
    for (const key of ['TELEPHONY_PROVIDER','TELEPHONY_API_URL','TELEPHONY_API_KEY','TELEPHONY_CALLER_ID','TELEPHONY_WEBHOOK_SECRET']) vi.stubEnv(key, 'fixture');
    vi.stubGlobal('fetch', vi.fn(async () => failing ? Response.json({ code: '22023', message: 'TICK_FAILURE' }, { status: 400 }) : Response.json({ jobs_created: 0, _changed_campaigns: [] })));
    queue = new Queue(name, { connection: { host: '127.0.0.1', port: 6379 } });
  });
  afterAll(async () => {
    await app?.close();
    await queue?.obliterate({ force: true }); await queue?.close();
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
  });
  async function boot(enabled = true) {
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(QueueStatus).useValue({ enabled }).compile();
    app = module.createNestApplication({ bodyParser: false }); configureApp(app); await app.init();
    return app.get(CampaignsScheduler);
  }
  it('registers one fixed 60-second scheduler across two app boots and processes the tick RPC', async () => {
    await boot();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled(), { timeout: 5000 });
    expect(await queue.getJobSchedulers()).toMatchObject([{ key: tickJobId, every: repeatEvery }]);
    await app!.close(); app = undefined;
    const scheduler = await boot();
    expect(await queue.getJobSchedulers()).toHaveLength(1);
    vi.mocked(fetch).mockClear();
    await queue.add('tick', {}, { jobId: 'processor-proof' });
    await vi.waitFor(() => expect(scheduler.status().lastResult).toEqual({ jobs_created: 0 }), { timeout: 5000 });
    expect(fetch).toHaveBeenCalledWith('https://provider.example/rest/v1/rpc/pose_system_campaign_tick', expect.objectContaining({ method: 'POST', body: expect.stringMatching(/"p_now":".*Z"/) }));
    failing = true; await queue.add('tick', {}, { jobId: 'failure-proof' });
    await vi.waitFor(() => expect(scheduler.status().lastError).toBe('TICK_FAILURE'), { timeout: 5000 });
    await vi.waitFor(async () => expect((await queue.getJob('failure-proof')) && await (await queue.getJob('failure-proof'))!.getState()).toBe('failed'), { timeout: 5000 });
    failing = false; await queue.add('tick', {}, { jobId: 'recovery-proof' });
    await vi.waitFor(() => expect(scheduler.status().lastError).toBeNull(), { timeout: 5000 });
  }, 15000);
  it('starts without Redis, warns once on registration failure and keeps HTTP health/manual tick available', async () => {
    await app!.close(); app = undefined;
    const savedPort = queueConnection.port;
    const warning = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    try {
      queueConnection.port = 6399;
      const scheduler = await boot();
      expect(scheduler.status().redis).toBe(false); expect(warning).toHaveBeenCalledTimes(1);
      await request(app!.getHttpServer()).get('/api/health').expect(200).expect(response => expect(response.body.redis).toBe(false));
      vi.stubEnv('CRON_SECRET', 'test-cron-secret-with-at-least-32-characters');
      await request(app!.getHttpServer()).post('/api/system/campaigns/tick').set('Authorization', 'Bearer test-cron-secret-with-at-least-32-characters').expect(200).expect({ item: { jobs_created: 0 } });
    } finally { queueConnection.port = savedPort; warning.mockRestore(); }
  }, 10000);
});
