import { Module } from '@nestjs/common';
import { GatewayModule } from '../../gateway/gateway.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { CampaignsController, CampaignsTickController } from './campaigns.controller.js';
import { CampaignsScheduler } from './campaigns.scheduler.js';
@Module({
  imports: [QueueModule, GatewayModule],
  controllers: [CampaignsController, CampaignsTickController],
  providers: [CampaignsScheduler],
})
export class CampaignsModule {}
