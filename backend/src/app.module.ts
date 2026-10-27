import { CallingModule } from './modules/calling/calling.module.js';
import { CampaignsModule } from './modules/campaigns/campaigns.module.js';
import { GatewayModule } from './gateway/gateway.module.js';
import { AiModule } from './modules/ai/ai.module.js';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard.js';
import { AccessController } from './auth/access.controller.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { SupabaseModule } from './modules/supabase/supabase.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AccountModule } from './modules/account/account.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { CustomerModule } from './modules/customer/customer.module.js';
import { WorkspaceModule } from './modules/workspace/workspace.module.js';
import { QueueModule } from './modules/queue/queue.module.js';
import { HealthController } from './modules/queue/health.controller.js';
import { LeadsModule } from './modules/leads/leads.module.js';
import { SalesModule } from './modules/sales/sales.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { AppointmentsModule } from './modules/appointments/appointments.module.js';
@Module({
  imports: [
    CallingModule,
    CampaignsModule,
    GatewayModule,
    AiModule,
    SupabaseModule,
    AuthModule,
    AccountModule,
    CatalogModule,
    CustomerModule,
    WorkspaceModule,
    QueueModule,
    LeadsModule,
    SalesModule,
    ReportsModule,
    AppointmentsModule,
  ],
  controllers: [AppController, AccessController, HealthController],
  providers: [AppService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
