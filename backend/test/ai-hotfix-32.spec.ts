import { describe, expect, it } from 'vitest';
import { preserveAreaSwitchCriteria, referencedListingCodes, renumberReferencedListings, searchCriteriaFromHistory } from '../src/modules/ai/history-aware.js';
import { normalizeFinalReply, sourcesFromCitations } from '../src/modules/ai/guard.js';

const vietnamese = {
  buyApartment: 'mua căn hộ thủ đức dưới 3 tỷ',
  district7: 'ở quận 7',
  district9: 'thế ở quận 9 đi',
  compare: 'so sánh căn 1 và căn 2 giúp tôi',
};

describe('Hotfix 32 regressions', () => {
  it('keeps the active transaction, type, and budget when switching area', () => {
    const history = [
      { role: 'user', content: vietnamese.buyApartment },
      { role: 'assistant', content: 'Tiêu chí: Căn hộ Mua, ở Thủ Đức, dưới 3 tỷ đồng.' },
      { role: 'user', content: vietnamese.district7 },
      { role: 'assistant', content: 'Tiêu chí: Căn hộ Mua, ở Quận 7, dưới 3 tỷ đồng.' },
    ];

    expect(searchCriteriaFromHistory(vietnamese.district9, history)).toMatchObject({
      location: 'Quận 9',
      type: 'Apartment',
      transaction_type: 'Sale',
      maxPrice: 3_000_000_000,
    });
    expect(preserveAreaSwitchCriteria({ location: 'Quận 9' }, searchCriteriaFromHistory('', history))).toMatchObject({
      location: 'Quận 9',
      type: 'Apartment',
      transaction_type: 'Sale',
      maxPrice: 3_000_000_000,
    });
  });

  it('resolves both numbered cards from the previous list for comparison', () => {
    const history = [{
      role: 'assistant',
      content: 'Căn hộ A [1], căn hộ B [5], căn hộ C [4].',
      sources: [
        { code: 'A' },
        { code: 'B' },
        { code: 'C' },
        { code: 'D' },
        { code: 'E' },
      ],
    }];

    expect(referencedListingCodes(vietnamese.compare, history)).toEqual({
      codes: ['A', 'B'],
      ambiguous: false,
    });
    expect(renumberReferencedListings([{ code: 'A', number: 1 }, { code: 'B', number: 5 }], ['A', 'B']).map(item => item.number)).toEqual([1, 5]);
  });

  it('keeps original numbers for single, comparison, and ordinal follow-ups', () => {
    const sources = ['A', 'B', 'C', 'D', 'E'].map((code, index) => ({ code, number: index + 1 }));
    const history = [{
      role: 'assistant',
      content: sources.map(source => `[${source.number}] Căn ${source.code}; giá ${source.number} tỷ.`).join('\n'),
      sources,
    }];
    const originalNumbers = new Map(sources.map(source => [source.code.toLowerCase(), source.number]));

    const second = referencedListingCodes('căn số 2 có sổ hồng chưa', history);
    const comparison = referencedListingCodes('so sánh căn 1 và căn 2 giúp tôi', history);
    const third = referencedListingCodes('căn thứ ba bao nhiêu tiền', history);

    expect(second.codes).toEqual(['B']);
    expect(comparison.codes).toEqual(['A', 'B']);
    expect(third.codes).toEqual(['C']);
    expect(renumberReferencedListings([{ code: 'B' }], second.codes, originalNumbers)[0].number).toBe(2);
    expect(renumberReferencedListings([{ code: 'A' }, { code: 'B' }], comparison.codes, originalNumbers).map(item => item.number)).toEqual([1, 2]);
    expect(renumberReferencedListings([{ code: 'C' }], third.codes, originalNumbers)[0].number).toBe(3);
    expect(sourcesFromCitations('Căn B [2].', [{ code: 'B', number: 2, price: 2_000_000_000 }])).toEqual([{ code: 'B', number: 2, price: 2_000_000_000 }]);
  });

  it('normalizes decimal areas and prices without changing citations', () => {
    const reply = normalizeFinalReply(
      'Căn hộ diện tích 61.4 m², giá 2.95 tỷ đồng [1].',
      'Thông tin căn hộ này là gì?',
      [{ availability: 'Available', number: 1 }],
      { includeAvailabilityNotice: false },
    );

    expect(reply).toContain('61,4 m²');
    expect(reply).toContain('2,95 tỷ đồng');
    expect(reply).toContain('[1]');
  });

  it('does not turn a listing that gifts furniture into a price-includes claim', () => {
    const reply = normalizeFinalReply(
      'Giá này đã bao gồm nội thất [1].',
      'Căn này có nội thất không?',
      [{ availability: 'Available', number: 1, description: 'tặng nội thất' }],
      { includeAvailabilityNotice: false },
    );

    expect(reply).toMatch(/tin đăng ghi tặng nội thất/iu);
    expect(reply).not.toContain('giá này đã bao gồm nội thất');
  });

  it('removes an unsupported furniture or fee inclusion claim', () => {
    const reply = normalizeFinalReply(
      'Giá này đã bao gồm nội thất và phí quản lý [1].',
      'Căn này có nội thất không?',
      [{ availability: 'Available', number: 1, description: 'Căn hộ có ban công.' }],
      { includeAvailabilityNotice: false },
    );

    expect(reply).not.toMatch(/đã bao gồm nội thất|bao gồm phí quản lý/iu);
    expect(reply).not.toContain('[1].');
  });

  it('keeps a fee inclusion claim when the listing states it', () => {
    const reply = normalizeFinalReply(
      'Giá đã bao gồm phí quản lý [1].',
      'Giá này đã gồm phí quản lý chưa?',
      [{ availability: 'Available', number: 1, description: 'Giá đã bao gồm phí quản lý trong thời hạn thuê.' }],
      { includeAvailabilityNotice: false },
    );

    expect(reply).toContain('Giá đã bao gồm phí quản lý [1].');
  });

  it('removes a model sentence that repeats còn mở bán after the canonical notice', () => {
    const reply = normalizeFinalReply(
      'Căn này đang được ghi là còn mở bán [1]. Căn này có diện tích 61,4 m².',
      'Căn này còn bán không?',
      [{ availability: 'Available', number: 1, updated_at: '2026-10-27T00:00:00.000Z' }],
      { specificListing: true },
    );

    expect(reply.match(/(?:đang được ghi là còn mở bán|còn mở bán)/giu)).toBeNull();
    expect(reply).toContain('Theo tin đăng, căn này đang ghi là còn bán');
    expect(reply).toContain('diện tích 61,4 m²');
  });
});
