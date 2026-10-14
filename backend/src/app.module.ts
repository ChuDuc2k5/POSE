import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { GatewayGateway } from './gateway/gateway.gateway.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ChatModule } from './modules/chat/chat.module.js';
import { CustomerModule } from './modules/customer/customer.module.js';
import { PropertyModule } from './modules/property/property.module.js';
import { UserModule } from './modules/user/user.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: 'backend',
    }),
    AuthModule,
    UserModule,
    PropertyModule,
    CustomerModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    GatewayGateway
  ],
})
export class AppModule {}
