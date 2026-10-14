import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller.js';
@Module({ controllers: [CustomerController] })
export class CustomerModule {}
