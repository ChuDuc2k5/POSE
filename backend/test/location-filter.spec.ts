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
