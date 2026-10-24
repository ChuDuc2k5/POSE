import { describe, expect, it } from 'vitest';
import { locationFilter } from '../src/modules/ai/ai.service.js';

describe('query location filter', () => {
  it('drops city-level Ho Chi Minh City names (the whole catalogue)', () => {
    for (const city of ['TP.HCM', 'TP HCM', 'tp. Hồ Chí Minh', 'Thành phố Hồ Chí Minh', 'Hồ Chí Minh', 'Sài Gòn', 'HCM']) expect(locationFilter(city)).toBeUndefined();
  });
  it('keeps district and area filters', () => {
    expect(locationFilter('Quận 7')).toBe('Quận 7');
    expect(locationFilter('Thủ Đức')).toBe('Thủ Đức');
    expect(locationFilter('Phú Mỹ Hưng')).toBe('Phú Mỹ Hưng');
    expect(locationFilter(null)).toBeUndefined();
  });
});

import { approximatePriceRange } from '../src/modules/ai/ai.service.js';
describe('approximate price', () => {
  it('widens an exact figure (min = max) to ±20%', () => {
    expect(approximatePriceRange({ minPrice: 25_000_000, maxPrice: 25_000_000 })).toEqual({ minPrice: 20_000_000, maxPrice: 30_000_000 });
  });
  it('keeps real ranges and one-sided limits', () => {
    expect(approximatePriceRange({ minPrice: 2e9, maxPrice: 3e9 })).toEqual({ minPrice: 2e9, maxPrice: 3e9 });
    expect(approximatePriceRange({ maxPrice: 5e9 })).toEqual({ maxPrice: 5e9 });
  });
});
