import { describe, expect, it } from 'vitest';
import { searchCriteriaFromHistory } from '../src/modules/ai/history-aware.js';
import { inferSearch } from '../src/modules/ai/infer-search.js';
import { groundedSummary, outputReason, type Evidence } from '../src/modules/ai/guard.js';

describe('Hotfix 15 area and budget continuity', () => {
  it('keeps the remembered sale ceiling while replacing only the area', () => {
    const history = [
      { role: 'user', content: 'Tôi muốn mua nhà' },
      { role: 'assistant', content: 'Bạn muốn mua ở khu vực nào và ngân sách khoảng bao nhiêu?' },
      { role: 'user', content: 'Ngân sách 3 tỷ' },
      { role: 'assistant', content: 'Bạn muốn mua ở khu vực nào?' },
      { role: 'user', content: 'ở Biên Hòa' },
      { role: 'assistant', content: 'Tiêu chí: Mua, ở Biên Hòa, tối đa 3 tỷ đồng.' },
      { role: 'user', content: 'thế ở quận 9 đi' },
      { role: 'assistant', content: 'Tiêu chí: Mua, ở Quận 9, tối đa 3 tỷ đồng.' },
    ];

    expect(searchCriteriaFromHistory('ở Thủ Đức', history)).toMatchObject({
      transaction_type: 'Sale',
      maxPrice: 3_000_000_000,
      location: 'Thủ Đức',
    });
    expect(inferSearch('ở Thủ Đức')).toMatchObject({ location: 'Thủ Đức' });
  });

  it('allows a remembered budget in an honest zero-match answer', () => {
    const preview = 'Biên Hòa … ngân sách khoảng 3 tỷ … hiện chưa có căn nào phù hợp …';
    expect(outputReason(preview, [], 'ở Biên Hòa', {
      retrievalFound: false,
      filterAmounts: [3_000_000_000],
      previousPrices: [],
    })).toBeNull();
  });

  it('keeps the ceiling strict and gives the deterministic listing fallback evidence', () => {
    const evidence: Evidence[] = [
      { id: '1', code: 'TD-1', name: 'Căn hộ Thủ Đức 2,99 tỷ', price: 2_990_000_000, availability: 'Available', updated_at: '2026-01-01', location: 'Thủ Đức', property_type: 'Apartment', transaction_type: 'Sale', price_period: 'Total', number: 1, source_type: 'Property' },
      { id: '2', code: 'TD-2', name: 'Căn hộ Thủ Đức 2,55 tỷ', price: 2_550_000_000, availability: 'Available', updated_at: '2026-01-01', location: 'Thủ Đức', property_type: 'Apartment', transaction_type: 'Sale', price_period: 'Total', number: 2, source_type: 'Property' },
    ];

    expect(outputReason('Căn hộ Thủ Đức 2,99 tỷ [1]. Căn hộ Thủ Đức 2,55 tỷ [2].', evidence, 'Ngân sách 3 tỷ', { filterAmounts: [3_000_000_000] })).toBeNull();
    expect(outputReason('Căn hộ Thủ Đức 4,5 tỷ [1].', evidence, 'Ngân sách 3 tỷ')).toBe('UNSUPPORTED_PRICE');
    expect(groundedSummary(evidence)).toContain('2,99 tỷ đồng');
    expect(groundedSummary(evidence)).toContain('2,55 tỷ đồng');
  });
});
