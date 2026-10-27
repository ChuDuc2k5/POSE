import { Module } from '@nestjs/common';
import { GatewayModule } from '../../gateway/gateway.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { CallingController } from './calling.controller.js';
import { CallingScheduler } from './calling.scheduler.js';
import { VoiceGateway } from './voice.gateway.js';
@Module({
  imports: [GatewayModule, QueueModule],
  controllers: [CallingController],
  providers: [CallingScheduler, VoiceGateway],
})
export class CallingModule {}
