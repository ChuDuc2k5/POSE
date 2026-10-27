import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { searchCriteriaFromHistory } from '../src/modules/ai/history-aware.js';
import { inferSearch } from '../src/modules/ai/infer-search.js';
import { catalogueLocationAliases } from '../src/modules/ai/location-aliases.js';

describe('Hotfix 25 tìm kiếm cấu trúc dùng chung', () => {
  it('dùng cùng ngữ nghĩa ngân sách cho các cách nói phổ biến', () => {
    expect(inferSearch('mua căn hộ quận 9 3 tỷ')).toMatchObject({ maxPrice: 3_000_000_000 });
    expect(inferSearch('mua căn hộ tầm 3 tỷ quận 9')).toMatchObject({ maxPrice: 3_300_000_000 });
    expect(inferSearch('nhà bình tân dưới 7 tỷ')).toMatchObject({ maxPrice: 7_000_000_000, maxPriceExclusive: true });
    expect(inferSearch('mua căn hộ từ 2 tỷ đến 3 tỷ')).toMatchObject({ minPrice: 2_000_000_000, maxPrice: 3_000_000_000 });
    expect(inferSearch('ngân sách 10 triệu')).toMatchObject({ maxPrice: 10_000_000 });
    expect(inferSearch('tầm 25 triệu')).toMatchObject({ maxPrice: 27_500_000 });
    expect(searchCriteriaFromHistory('ở Gò Vấp', [
      { role: 'user', content: 'mua nhà dưới 8 tỷ ở Bình Tân' },
      { role: 'assistant', content: 'Tiêu chí: Mua, ở Bình Tân, dưới 8 tỷ đồng.' },
    ])).toMatchObject({ location: 'Gò Vấp', maxPrice: 8_000_000_000, maxPriceExclusive: true });
  });

  it('nhận diện Vũng Tàu và các khu vực dự án như địa điểm catalogue', () => {
    expect(inferSearch('mua nhà ở vũng tàu dưới 5 tỷ')).toMatchObject({ location: 'Vũng Tàu' });
    expect(inferSearch('thuê căn hộ phú mỹ hưng dưới 30 triệu')).toMatchObject({ location: 'Phú Mỹ Hưng' });
    expect(catalogueLocationAliases('Vũng Tàu')).toEqual(expect.arrayContaining(['Phường Vũng Tàu', 'Bà Rịa']));
    expect(catalogueLocationAliases('Phú Mỹ Hưng')).toEqual(expect.arrayContaining(['Quận 7', 'Tân Phong', 'Phú Mỹ Hưng']));
  });

  it('không còn nhánh tìm kiếm riêng cho một khu vực trong ai.service', () => {
    const source = readFileSync(new URL('../src/modules/ai/ai.service.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/structuredCriteriaAlias|explicitStructuredCriteria|q7SaleBudgetQuestion/);
    expect(source).not.toMatch(/quận\\s\\*9/iu);
  });
});
