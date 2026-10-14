import '../../env.js';
import { Module, Logger, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { Redis } from 'ioredis';

const connection = { host: process.env.REDIS_HOST || '127.0.0.1', port: Number(process.env.REDIS_PORT || 6379) };
let redisAvailable = false;
if (process.env.NODE_ENV !== 'test') {
  const probe = new Redis({ ...connection, lazyConnect: true, retryStrategy: () => null, connectTimeout: 500, maxRetriesPerRequest: 0 });
  probe.on('error', () => {});
  try { await probe.connect(); redisAvailable = (await probe.ping()) === 'PONG'; } catch { /* Redis is optional. */ }
  finally { probe.disconnect(); }
  if (!redisAvailable) new Logger('QueueModule').warn('Redis chưa khả dụng; hàng đợi đã tắt.');
}
@Injectable()
export class QueueStatus implements OnApplicationShutdown {
  readonly enabled = redisAvailable;
  onApplicationShutdown() { redisAvailable = false; }
}
@Module({
  imports: redisAvailable ? [BullModule.forRoot({ connection }), BullModule.registerQueue({ name: 'pose-jobs' })] : [],
  providers: [QueueStatus], exports: [QueueStatus, ...(redisAvailable ? [BullModule] : [])],
})
export class QueueModule {}
