import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard.js';
import { AccessController } from './auth/access.controller.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { GatewayGateway } from './gateway/gateway.gateway.js';
import { SupabaseModule } from './modules/supabase/supabase.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AccountModule } from './modules/account/account.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { CustomerModule } from './modules/customer/customer.module.js';
import { WorkspaceModule } from './modules/workspace/workspace.module.js';
import { QueueModule } from './modules/queue/queue.module.js';
import { HealthController } from './modules/queue/health.controller.js';
@Module({
  imports: [SupabaseModule, AuthModule, AccountModule, CatalogModule, CustomerModule, WorkspaceModule, QueueModule],
  controllers: [AppController, AccessController, HealthController],
  providers: [AppService, { provide: APP_GUARD, useClass: AuthGuard }, GatewayGateway],
})
export class AppModule {}
