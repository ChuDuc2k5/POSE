import { describe, expect, it } from 'vitest';
import { inferSearch } from '../src/modules/ai/infer-search.js';
import { hasNoMatchReply, noMatchReply, unsupportedCriteria } from '../src/modules/ai/unsupported.js';
import { budgetFollowUp } from '../src/modules/ai/history-aware.js';
import { groundedSummary, normalizeCitations, outputReason, sourcesFromCitations, type Evidence } from '../src/modules/ai/guard.js';

describe('M06 change 3 review fixes', () => {
  it('does not read "ngân hàng" as a short-term lease', () => {
    expect(unsupportedCriteria('Anh có khoảng 2 tỷ tiền mặt, nếu vay thêm ngân hàng thì mua được những căn nào?')).toEqual(['khoản vay ngân hàng']);
    expect(unsupportedCriteria('Tôi muốn thuê nhà trong 6 tháng, có hỗ trợ hợp đồng ngắn hạn không?')).toEqual(['hợp đồng ngắn hạn']);
  });
  it('treats the amount next to a loan as cash in hand', () => {
    expect(inferSearch('Anh có khoảng 2 tỷ tiền mặt, nếu vay thêm ngân hàng thì mua được những căn nào?')?.maxPrice).toBe(5000000000);
    expect(inferSearch('Nếu tôi có sẵn 2 tỷ và muốn vay ngân hàng thì có thể mua căn nào?')?.maxPrice).toBe(5000000000);
  });
  it('writes the no-match reply with accents and the customer criteria', () => {
    expect(noMatchReply('Tôi muốn mua căn hộ ở Quận 7, ngân sách khoảng 3 tỷ.')).toContain('ở Quận 7 trong khoảng 3 tỷ');
    expect(noMatchReply('Với ngân sách 2 tỷ, tôi có thể mua những bất động sản nào ở Tân Phú?')).toContain('ở Tân Phú trong khoảng 2 tỷ');
  });
  it('detects an existing no-match paragraph so the prefix is not duplicated', () => {
    expect(hasNoMatchReply('Hiện chưa tìm thấy căn nào phù hợp trong Quận 7.')).toBe(true);
    expect(hasNoMatchReply('Mình có thể giúp bạn tìm căn hộ phù hợp.')).toBe(false);
  });
  it('uses structured prices from the previous cards for budget follow-ups', () => {
    const history = [
      { role: 'user', content: 'Tôi muốn thuê chung cư ở Quận 7, khoảng 15 triệu' },
      { role: 'assistant', content: 'Mình thấy các căn khoảng 15 triệu phù hợp.', sources: [{ price: 12000000 }, { price: 12000000 }, { price: 11000000 }] },
    ];
    expect(budgetFollowUp('Rẻ hơn được không', history)?.filters.maxPrice).toBe(9900000);
    expect(budgetFollowUp('Cao cấp hơn chút', history)?.filters.minPrice).toBe(12000001);
  });
  it('keeps fallback cards aligned with citations and uses natural prices', () => {
    const first = { id: '1', code: 'RV-A', name: 'Sunshine Sky City', price: 4980000000, availability: 'Available', updated_at: '', location: 'Phường An Phú, Quận 2 cũ', property_type: 'Apartment', source_type: 'Property' } as Evidence;
    const second = { ...first, id: '2', code: 'RV-B', name: 'Căn hộ khác', price: 5100000000, number: 2 } as Evidence;
    expect(sourcesFromCitations('Bạn có thể xem căn [1].', [first, second])).toEqual([first]);
    expect(groundedSummary([first])).toContain('4,98 tỷ đồng');
  });
  it('allows effective server limits but blocks invented listing prices', () => {
    const empty = [] as Evidence[];
    expect(outputReason('Hiện chưa có căn hộ cho thuê ở Quận 7 dưới 5,75 tỷ trong dữ liệu mình có.', empty, 'tìm thuê ở Quận 7', { retrievalFound: false, filterAmounts: [5750000000] })).toBeNull();
    const listing = [{ id: '1', code: 'RVL-1', name: 'Nhà', price: 4980000000, availability: 'Available', updated_at: '', location: 'Thủ Đức', property_type: 'House', number: 1 }] as Evidence[];
    expect(outputReason('Nhà giá 3,2 tỷ [1].', listing)).toBe('UNSUPPORTED_PRICE');
  });
  it('normalizes raw bracketed catalogue codes to citation numbers', () => {
    const source = [{ number: 1, code: 'RVL-696470CA75378ACF' }];
    expect(normalizeCitations('Xem căn [RVL-696470CA75378ACF].', source)).toBe('Xem căn [1].');
  });
});
