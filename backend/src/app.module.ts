import { Module } from '@nestjs/common';
import { observeEnabled } from './env.js';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { GatewayGateway } from './gateway/gateway.gateway.js';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard.js';
import { AccessController } from './auth/access.controller.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ...(observeEnabled ? [ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY!,
      appSecret: process.env.OBSERVE_APP_SECRET!,
      serviceId: 'backend',
    })] : []),
  ],
  controllers: [AppController, AccessController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: AuthGuard },
    GatewayGateway
  ],
})
export class AppModule {}
