import { describe, expect, it } from 'vitest';
import { centralFormerDistricts, inferSearch } from '../src/modules/ai/infer-search.js';
import { catalogueOverviewIntent, concreteSearchKeywords, isMoreRequest } from '../src/modules/ai/history-aware.js';

describe('hotfix 10c deterministic corrections', () => {
  it('lets the later price and area statements win', () => {
    const result = inferSearch('Tôi cần đất mua dưới 1,5 tỷ, diện tích ít nhất 100 m², đường ô tô vào được, cách trung tâm không quá 10 km. À, tôi chỉ có 1,2 tỷ thôi, nhưng vẫn muốn diện tích tối thiểu 120 m².');
    expect(result).toMatchObject({ type: 'Land', transaction_type: 'Sale', maxPrice: 1_200_000_000, minArea: 120, locations: centralFormerDistricts });
    expect(result?.keywords).toContain('đậu ô tô');
  });

  it('treats correction wording and only-X wording as a ceiling', () => {
    expect(inferSearch('Tìm nhà 3 tỷ ở Quận 7, à nhầm, 2,5 tỷ thôi')).toMatchObject({ maxPrice: 2_500_000_000 });
    expect(inferSearch('Tìm nhà, chỉ có 1,2 tỷ')).toMatchObject({ maxPrice: 1_200_000_000 });
  });

  it('recognizes catalogue overviews and more requests before clarification', () => {
    expect(catalogueOverviewIntent('Hiện tại bạn có bất động sản ở những khu vực nào')).toBe('areas');
    expect(catalogueOverviewIntent('Bên bạn đang bán những loại BĐS nào?')).toBe('types');
    expect(catalogueOverviewIntent('Bên bạn có cho thuê không')).toBe('types');
    expect(catalogueOverviewIntent('Có những dự án nào')).toBe('projects');
    expect(isMoreRequest('có căn nào khác không')).toBe(true);
    expect(concreteSearchKeywords('đường ô tô vào được, hẻm xe hơi')).toContain('đậu ô tô');
  });
});
