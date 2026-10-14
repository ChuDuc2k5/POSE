import { Injectable } from '@nestjs/common';

export interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  email?: string;
  status?: string;
  createdAt?: string;
}

@Injectable()
export class CustomerRepository {
  private readonly customers: CustomerRow[] = [
    {
      id: 'customer-1',
      name: 'Nguyễn Văn A',
      phone: '+84 912 345 678',
      email: 'nguyenvana@example.com',
      status: 'new',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'customer-2',
      name: 'Nguyễn Thị B',
      phone: '+84 933 555 111',
      email: 'nguyenthib@example.com',
      status: 'warm',
      createdAt: new Date().toISOString(),
    },
  ];

  async findAll(): Promise<CustomerRow[]> {
    return this.customers;
  }

  async findById(id: string): Promise<CustomerRow | null> {
    return this.customers.find((item) => item.id === id) ?? null;
  }
}
