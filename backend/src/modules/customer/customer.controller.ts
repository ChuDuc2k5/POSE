import { Controller, Get, Param } from '@nestjs/common';
import { CustomerService } from './customer.service.js';

@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get()
  async getCustomers() {
    return this.customerService.listCustomers();
  }

  @Get(':id')
  async getCustomerById(@Param('id') id: string) {
    return this.customerService.getCustomerById(id);
  }
}
