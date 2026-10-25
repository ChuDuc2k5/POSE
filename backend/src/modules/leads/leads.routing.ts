import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { systemClient } from '../supabase/supabase.service.js';

@Injectable()
export class LeadRoutingWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private warned = false;
  private readonly logger = new Logger('LeadRouting');

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' || process.env.LEAD_ROUTING_ENABLED === 'false'
      || !process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return;
    const configured = Number(process.env.LEAD_ROUTING_INTERVAL_MS || 15000);
    const interval = Number.isFinite(configured) ? Math.max(5000, configured) : 15000;
    this.timer = setInterval(() => { void this.tick(); }, interval);
    this.timer.unref();
    void this.tick();
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const { data, error } = await systemClient().rpc('pose_lead_route_batch', { p_limit: 25 })
        .abortSignal(AbortSignal.timeout(10000));
      if (error) throw new Error(error.code || 'UNAVAILABLE');
      if (data?.failed && !this.warned) {
        this.logger.warn('Một số Lead chưa xét được phân công; hàng đợi sẽ thử lại.');
        this.warned = true;
      } else if (!data?.failed) this.warned = false;
    } catch {
      if (!this.warned) this.logger.warn('Chưa thể xử lý hàng đợi phân công. Kiểm tra migration và kết nối Supabase.');
      this.warned = true;
    } finally { this.busy = false; }
  }
  onApplicationShutdown() { if (this.timer) clearInterval(this.timer); }
}
