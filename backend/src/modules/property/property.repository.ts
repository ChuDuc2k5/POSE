import { Injectable } from '@nestjs/common';

export interface PropertyRow {
  id: string;
  title: string;
  location: string;
  price: number;
  area: number;
  bedrooms: number;
  bathrooms: number;
  type: string;
  status?: string;
  description?: string;
  code?: string;
  image?: string;
  broker?: string;
  furnishing?: string;
  direction?: string;
  amenities?: string[];
}

@Injectable()
export class PropertyRepository {
  private readonly properties: PropertyRow[] = [
    {
      id: 'prop-001',
      title: 'Căn hộ 3PN GH3',
      code: 'VGP-260607-WYKL',
      type: 'Apartment',
      location: 'Vinhomes Grand Park, Quận 9',
      price: 4200000000,
      area: 83,
      bedrooms: 3,
      bathrooms: 2,
      direction: 'Đông Nam',
      furnishing: 'Đầy đủ nội thất',
      amenities: ['Hồ bơi', 'Gym', 'Công viên', 'An ninh 24/7'],
      description: 'Căn hộ 3 phòng ngủ view xanh, phù hợp gia đình trẻ hoặc đầu tư dài hạn.',
      broker: 'Revoland City Homes',
      image: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80',
      status: 'available',
    },
    {
      id: 'prop-002',
      title: 'Căn hộ 2PN View River',
      code: 'D7-180402-QTFC',
      type: 'Apartment',
      location: 'District 7, TP.HCM',
      price: 3100000000,
      area: 72,
      bedrooms: 2,
      bathrooms: 2,
      direction: 'Nam',
      furnishing: 'Cơ bản',
      amenities: ['Ban công', 'Bãi xe', 'Phòng gym', 'Tiện ích chung'],
      description: 'Căn hai phòng ngủ view sông, tiện nghi đầy đủ, vị trí thuận tiện di chuyển.',
      broker: 'Revoland Residential',
      image: 'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1200&q=80',
      status: 'available',
    },
    {
      id: 'prop-003',
      title: 'Căn hộ 2PN Sky Garden',
      code: 'TD-240110-KL72',
      type: 'Apartment',
      location: 'Thủ Đức, TP.HCM',
      price: 2800000000,
      area: 68,
      bedrooms: 2,
      bathrooms: 2,
      direction: 'Tây Nam',
      furnishing: 'Chưa nội thất',
      amenities: ['Hồ bơi', 'Clubhouse', 'Chỗ để xe', 'Bảo vệ'],
      description: 'Căn hộ hiện đại cho người mua cần không gian sống thoải mái với ngân sách hợp lý.',
      broker: 'Revoland Advisory',
      image: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=1200&q=80',
      status: 'available',
    },
  ];

  async findAll(): Promise<PropertyRow[]> {
    return this.properties;
  }

  async findById(id: string): Promise<PropertyRow | null> {
    return this.properties.find((item) => item.id === id) ?? null;
  }

  async search(filters: Partial<PropertyRow> & { minPrice?: number; maxPrice?: number; limit?: number }): Promise<PropertyRow[]> {
    let results = [...this.properties];

    if (filters.location) {
      results = results.filter((item) => item.location.toLowerCase().includes(filters.location!.toLowerCase()));
    }
    if (filters.type) {
      results = results.filter((item) => item.type.toLowerCase() === filters.type!.toLowerCase());
    }
    if (filters.minPrice !== undefined) {
      results = results.filter((item) => item.price >= filters.minPrice!);
    }
    if (filters.maxPrice !== undefined) {
      results = results.filter((item) => item.price <= filters.maxPrice!);
    }
    if (filters.bedrooms !== undefined) {
      results = results.filter((item) => item.bedrooms === filters.bedrooms);
    }

    return (filters.limit ? results.slice(0, filters.limit) : results);
  }
}
