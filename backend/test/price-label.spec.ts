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

import { outputReason } from '../src/modules/ai/guard.js';
describe('guard price echo', () => {
  const e = (n:number, code:string, name:string, price:number) => ({ id:String(n), code, name, price, availability:'Available', updated_at:'2026-01-01', location:'Quận 7, TP. Hồ Chí Minh', property_type:'Apartment', transaction_type:'Rent' as const, price_period:'Month' as const, bedrooms:2, number:n });
  const ev = [e(1,'CFR-2C0F11B2119C337A','Cho thuê Sunrise Riverside - Full nội thất 2 PN 14 triệu/tháng',14000000), e(2,'CFR-4F6E97F2C8068AFB','The Golden Star 2PN giá 12TR',12000000)];
  const q = 'Tôi muốn thuê căn hộ 2 phòng ngủ ở Quận 7 dưới 15 triệu/tháng';
  it('allows the customer limit repeated as a limit', () => {
    expect(outputReason('Có căn hộ ở Quận 7 với giá dưới 15 triệu/tháng. Căn hộ Sunrise Riverside, 2PN, giá 14 triệu đồng/tháng [1].', ev, q)).toBeNull();
  });
  it('still blocks invented ranges and prices', () => {
    expect(outputReason('Các căn tương tự có giá từ 12 đến 16 triệu đồng/tháng [1][2].', ev, q)).toBe('UNSUPPORTED_PRICE');
    expect(outputReason('Căn hộ Sunrise Riverside giá 13 triệu đồng/tháng [1].', ev, q)).toBe('UNSUPPORTED_PRICE');
  });
});
