import { Injectable, Logger, type OnModuleInit, type OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { QueueStatus, queueConnection } from '../queue/queue.module.js';
import { GatewayGateway } from '../../gateway/gateway.gateway.js';
import { WebRequest } from '../../common/http.js';
import { systemClient } from '../supabase/supabase.service.js';
import { cronAuthorized } from '../campaigns/campaigns.scheduler.js';
import { catalogError, catalogJson } from '../catalog/catalog.service.js';
import { dispatchDue, reconcileDue } from './server.js';
import { dispatcherEvery, reconcileEvery, callConcurrency } from './config.js';

export { dispatcherEvery, reconcileEvery, callConcurrency } from './config.js';
@Injectable()
export class CallingScheduler implements OnModuleInit, OnApplicationShutdown {
  private queue?: Queue;
  private worker?: Worker;
  private enabled = false;
  private lastRunAt: string | null = null;
  private lastResult: object | null = null;
  private lastError: string | null = null;
  private readonly logger = new Logger('CallingScheduler');
  constructor(private readonly queues: QueueStatus, private readonly gateway: GatewayGateway) {}
  status() { return { redis: this.enabled, dispatcherEvery, reconcileEvery, lastRunAt: this.lastRunAt, lastResult: this.lastResult, lastError: this.lastError }; }
  async onModuleInit() {
    if (!this.queues.enabled || process.env.TELEPHONY_PROVIDER !== 'simulator') return;
    const name = process.env.CALLS_QUEUE_NAME || 'calls';
    try {
      this.queue = new Queue(name, { connection: { ...queueConnection, maxRetriesPerRequest: 0, connectTimeout: 500, retryStrategy: () => null } });
      this.queue.on('error', () => { this.enabled = false; });
      await this.queue.upsertJobScheduler('calls-dispatch', { every: dispatcherEvery }, { name: 'dispatch', data: {}, opts: { removeOnComplete: 20, removeOnFail: 20 } });
      await this.queue.upsertJobScheduler('calls-reconcile', { every: reconcileEvery }, { name: 'reconcile', data: {}, opts: { removeOnComplete: 20, removeOnFail: 20 } });
      this.worker = new Worker(name, job => this.run(job.name === 'reconcile' ? 'reconcile' : 'dispatch'), { connection: { ...queueConnection, maxRetriesPerRequest: null }, concurrency: callConcurrency() });
      this.worker.on('error', () => { this.enabled = false; });
      this.enabled = true;
    } catch {
      this.enabled = false;
      this.logger.warn('Redis chưa khả dụng; dùng điều phối cuộc gọi thủ công.');
      await this.onApplicationShutdown();
    }
  }
  async notify(id: string) {
    try {
      const result = await systemClient().rpc('pose_system_call_context', { p_call: id });
      if (!result.error && result.data) await this.gateway.callStatus(result.data);
    } catch { this.logger.warn('Chưa thể cập nhật trạng thái cuộc gọi trực tiếp.'); }
  }
  async run(kind: 'dispatch' | 'reconcile') {
    this.lastRunAt = new Date().toISOString();
    try {
      const result = await (kind === 'dispatch' ? dispatchDue : reconcileDue)(id => this.notify(id));
      this.lastResult = result; this.lastError = null;
      return result;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'CALLS_UNAVAILABLE';
      throw error;
    }
  }
  async http(request: WebRequest, kind: 'dispatch' | 'reconcile') {
    if (!cronAuthorized(request.headers.get('authorization'))) return catalogError('UNAUTHORIZED', 'Không có quyền thực thi.', 401);
    try { return catalogJson(await this.run(kind)); }
    catch { return catalogError('CALLS_UNAVAILABLE', 'Không thể xử lý cuộc gọi. Vui lòng thử lại.', 503); }
  }
  async onApplicationShutdown() {
    await this.worker?.close(); await this.queue?.close();
    this.worker = undefined; this.queue = undefined; this.enabled = false;
  }
}
