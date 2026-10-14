import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../../auth/auth.guard.js';
import { QueueStatus } from './queue.module.js';
@Controller('health')
export class HealthController {
  constructor(private readonly queue: QueueStatus) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @Public()
  health() {
    const supabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);
    return { ok: supabase, supabase, redis: this.queue.enabled };
  }
}
