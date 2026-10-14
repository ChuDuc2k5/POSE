import { Injectable, Logger, type OnModuleInit, type OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { timingSafeEqual } from 'node:crypto';
import { WebRequest } from '../../common/http.js';
import { telephonyConfigured } from '../../common/telephony.js';
import { GatewayGateway } from '../../gateway/gateway.gateway.js';
import { QueueStatus, queueConnection } from '../queue/queue.module.js';
import { systemClient } from '../supabase/supabase.service.js';
import { catalogError, catalogJson } from '../catalog/catalog.service.js';
import { campaignDatabaseError } from './campaigns.handlers.js';

export const repeatEvery = 60000;
export const tickJobId = 'campaign-tick';
export function cronAuthorized(header: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7)), expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
export class TickError extends Error {
  constructor(readonly database: { code?: string; message?: string; details?: string }) { super(database.message || 'CAMPAIGN_UNAVAILABLE'); }
}
@Injectable()
export class CampaignsScheduler implements OnModuleInit, OnApplicationShutdown {
  private queue?: Queue;
  private worker?: Worker;
  private lastRunAt: string | null = null;
  private lastResult: Record<string, unknown> | null = null;
  private lastError: string | null = null;
  private warned = false;
  private readonly logger = new Logger('CampaignsScheduler');
  constructor(private readonly queues: QueueStatus, private readonly gateway: GatewayGateway) {}
  status() { return { redis: this.queues.enabled, repeatEvery, lastRunAt: this.lastRunAt, lastResult: this.lastResult, lastError: this.lastError }; }
  async onModuleInit() {
    if (!this.queues.enabled) return;
    const name = process.env.CAMPAIGNS_QUEUE_NAME || 'campaigns';
    try {
      this.queue = new Queue(name, { connection: { ...queueConnection, maxRetriesPerRequest: 0, connectTimeout: 500, retryStrategy: () => null } });
      this.queue.on('error', () => this.redisUnavailable());
      await this.queue.upsertJobScheduler(tickJobId, { every: repeatEvery }, { name: 'tick', data: {}, opts: { removeOnComplete: 20, removeOnFail: 20 } });
      this.worker = new Worker(name, async () => this.tick(), { connection: { ...queueConnection, maxRetriesPerRequest: null }, concurrency: 1 });
      this.worker.on('error', () => this.redisUnavailable());
    } catch {
      this.redisUnavailable();
      await this.onApplicationShutdown();
    }
  }
  private redisUnavailable() {
    this.queues.enabled = false;
    if (!this.warned) { this.warned = true; this.logger.warn('Redis chưa khả dụng; dùng tick thủ công.'); }
  }
  async tick(now = new Date().toISOString()) {
    this.lastRunAt = new Date().toISOString();
    try {
      if (!telephonyConfigured()) throw new Error('TELEPHONY_NOT_CONFIGURED');
      const r = await systemClient().rpc('pose_system_campaign_tick', { p_now: now });
      if (r.error) throw new TickError(r.error);
      const { _changed_campaigns: changed = [], ...result } = r.data as Record<string, unknown>;
      this.lastResult = result; this.lastError = null;
      if (Array.isArray(changed)) await this.gateway.campaignProgress(changed.filter((id): id is string => typeof id === 'string'));
      return result;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'CAMPAIGN_UNAVAILABLE';
      throw error;
    }
  }
  async httpTick(request: WebRequest) {
    if (!cronAuthorized(request.headers.get('authorization'))) return catalogError('UNAUTHORIZED', 'Cron chưa được xác thực.', 401);
    if (!telephonyConfigured()) return catalogError('TELEPHONY_NOT_CONFIGURED', 'Chưa cấu hình nhà cung cấp cuộc gọi.', 503);
    try { return catalogJson({ item: await this.tick() }); }
    catch (error) { return error instanceof TickError ? campaignDatabaseError(error.database) : catalogError('CAMPAIGN_UNAVAILABLE', 'Không thể điều phối chiến dịch.', 503); }
  }
  async onApplicationShutdown() {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = undefined; this.queue = undefined;
  }
}
