import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { CallingModule } from '../src/modules/calling/calling.module.js';
import { CallingScheduler } from '../src/modules/calling/calling.scheduler.js';
import { QueueStatus, queueConnection } from '../src/modules/queue/queue.module.js';

const probe = new Redis({
  host: '127.0.0.1',
  port: 6379,
  lazyConnect: true,
  connectTimeout: 500,
  retryStrategy: () => null,
  maxRetriesPerRequest: 0,
});
probe.on('error', () => {});
let reachable = false;
try {
  await probe.connect();
  reachable = (await probe.ping()) === 'PONG';
} catch {
} finally {
  probe.disconnect();
}
if (!reachable) console.log('SKIP: M08 real Redis integration; 127.0.0.1:6379 is not reachable.');
describe.skipIf(!reachable)('calls real Redis worker', () => {
  let app: INestApplication | undefined, queue: Queue;
  const name = `calls-test-${process.pid}-${Date.now()}`;
  beforeAll(() => {
    vi.stubEnv('CALLS_QUEUE_NAME', name);
    vi.stubEnv('TELEPHONY_PROVIDER', 'simulator');
    vi.stubEnv('TELEPHONY_MAX_CONCURRENCY', '99');
    queue = new Queue(name, { connection: { host: '127.0.0.1', port: 6379 } });
  });
  afterAll(async () => {
    await app?.close();
    await queue.obliterate({ force: true });
    await queue.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  async function boot(enabled = true) {
    const module = await Test.createTestingModule({ imports: [CallingModule] })
      .overrideProvider(QueueStatus)
      .useValue({ enabled })
      .compile();
    app = module.createNestApplication({ bodyParser: false });
    await app.init();
    return app.get(CallingScheduler);
  }
  it('registers two fixed schedulers once across two boots and limits the real worker to two jobs', async () => {
    let active = 0,
      maximum = 0,
      completed = 0;
    vi.spyOn(CallingScheduler.prototype, 'run').mockImplementation(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((r) => setTimeout(r, 100));
      active--;
      completed++;
      return { items: [] };
    });
    await boot();
    expect(
      (await queue.getJobSchedulers())
        .map((j) => ({ key: j.key, every: j.every }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    ).toEqual([
      { key: 'calls-dispatch', every: 10000 },
      { key: 'calls-reconcile', every: 60000 },
    ]);
    await app!.close();
    app = undefined;
    await boot();
    expect(await queue.getJobSchedulers()).toHaveLength(2);
    await queue.removeJobScheduler('calls-dispatch');
    await queue.removeJobScheduler('calls-reconcile');
    await queue.drain(true);
    await vi.waitFor(() => expect(active).toBe(0));
    maximum = 0;
    completed = 0;
    for (let n = 0; n < 5; n++) await queue.add('dispatch', {}, { jobId: `concurrency-${n}`, removeOnComplete: false });
    await vi.waitFor(
      async () => {
        for (let n = 0; n < 5; n++)
          expect(await (await queue.getJob(`concurrency-${n}`))!.getState()).toBe('completed');
      },
      { timeout: 5000 },
    );
    expect(completed).toBeGreaterThanOrEqual(5);
    expect(maximum).toBe(2);
  }, 15000);
  it('starts with Redis disabled and also shuts down failed connections', async () => {
    await app!.close();
    app = undefined;
    const disabled = await boot(false);
    expect(disabled.status().redis).toBe(false);
    await app!.close();
    app = undefined;
    const saved = queueConnection.port;
    try {
      queueConnection.port = 6399;
      const unavailable = await boot();
      expect(unavailable.status().redis).toBe(false);
    } finally {
      queueConnection.port = saved;
    }
  }, 10000);
});
