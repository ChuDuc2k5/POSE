export type PropertyType = 'Apartment' | 'Villa' | 'Townhouse';

export interface PropertyRecord {
  id: string;
  title: string;
  code: string;
  type: PropertyType;
  location: string;
  price: number;
  area: number;
  bedrooms: number;
  bathrooms: number;
  direction: string;
  furnishing: string;
  amenities: string[];
  description: string;
  broker: string;
  image: string;
  url: string;
}

export const properties: PropertyRecord[] = [
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
    url: '/bat-dong-san/prop-001',
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
    url: '/bat-dong-san/prop-002',
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
    url: '/bat-dong-san/prop-003',
  },
  {
    id: 'prop-004',
    title: 'Biệt thự 4PN Garden Lane',
    code: 'BTH-32091-VNQ',
    type: 'Villa',
    location: 'Long An',
    price: 9800000000,
    area: 220,
    bedrooms: 4,
    bathrooms: 3,
    direction: 'Đông Bắc',
    furnishing: 'Đầy đủ nội thất',
    amenities: ['Sân vườn', 'Bể bơi', 'Phòng khách rộng', 'An ninh'],
    description: 'Biệt thự không gian sống xanh, phù hợp gia đình lớn hoặc đầu tư lâu dài.',
    broker: 'Revoland Elite',
    image: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=1200&q=80',
    url: '/bat-dong-san/prop-004',
  },
];

export const propertyMap = Object.fromEntries(properties.map((property) => [property.id, property])) as Record<string, PropertyRecord>;
