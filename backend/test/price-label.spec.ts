import { describe, expect, it } from 'vitest';
import { moneyAmounts, priceLabel } from '../src/modules/ai/money.js';

describe('priceLabel', () => {
  it('formats catalogue prices so the guard reads them back exactly', () => {
    const cases: [number, boolean, string][] = [
      [4100000000, false, '4,1 tỷ đồng'], [18000000000, false, '18 tỷ đồng'], [5850000000, false, '5,85 tỷ đồng'],
      [4125000000, false, '4 tỷ 125 triệu đồng'], [10000000, true, '10 triệu đồng/tháng'], [12500000, true, '12,5 triệu đồng/tháng'],
      [4500000, true, '4,5 triệu đồng/tháng'], [12345678, false, '12.345.678 đồng'],
    ];
    for (const [price, monthly, label] of cases) {
      expect(priceLabel(price, monthly)).toBe(label);
      expect(moneyAmounts(label)).toEqual([price]);
    }
    expect(priceLabel(null)).toBe('chưa công bố');
  });
});
