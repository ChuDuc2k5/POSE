import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller.js';
import { LeadRoutingWorker } from './leads.routing.js';

@Module({ controllers: [LeadsController], providers: [LeadRoutingWorker] })
export class LeadsModule {}
