import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomerRepository } from './customer.repository.js';

@Injectable()
export class CustomerService {
  constructor(private readonly customerRepository: CustomerRepository) {}

  async listCustomers() {
    return { success: true, data: await this.customerRepository.findAll(), message: null };
  }

  async getCustomerById(id: string) {
    const customer = await this.customerRepository.findById(id);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return { success: true, data: customer, message: null };
  }
}
