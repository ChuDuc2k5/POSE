import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller.js';
import { AdminSalesController } from './admin-sales.controller.js';
@Module({ controllers: [WorkspaceController, AdminSalesController] })
export class WorkspaceModule {}
