import { describe, expect, it } from 'vitest';
import { referencedListingCodes } from '../src/modules/ai/history-aware.js';
import { normalizeListedPrices } from '../src/modules/ai/guard.js';

describe('Hotfix 23 single-card and price regressions', () => {
  it('treats a budget-only change as a refinement even after one cited card', () => {
    const history = [
      { role: 'user', content: 'mua căn hộ quận 9 3 tỷ' },
      { role: 'assistant', content: 'Căn hộ [1].', sources: [{ code: 'RVL-ONE', price: 2_990_000_000 }] },
    ];
    expect(referencedListingCodes('giờ tôi chỉ còn 2,5 tỷ thôi', history)).toEqual({ codes: [], ambiguous: false });
    expect(referencedListingCodes('căn này giá bao nhiêu?', history)).toEqual({ codes: ['RVL-ONE'], ambiguous: false });
  });

  it('normalizes raw grouped-digit prices only when they match cited evidence', () => {
    const reply = 'Giá thuê 5,300,000 đồng/tháng; giá bán 2,950,000,000 đồng.';
    const result = normalizeListedPrices(reply, [
      { price: 5_300_000, transaction_type: 'Rent', price_period: 'Month' },
      { price: 2_950_000_000, transaction_type: 'Sale', price_period: 'Total' },
    ]);
    expect(result).toContain('5,3');
    expect(result).toContain('2,95');
    expect(result).not.toContain('5,300,000');
    expect(result).not.toContain('2,950,000,000');
  });
});
