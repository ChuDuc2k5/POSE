import { describe, expect, it } from 'vitest';
import { outputReason } from '../src/modules/ai/guard.js';

const evidence = [{ id: '43c016e3-28ad-40ff-b352-bf75717805cb', code: 'CFR-79F29F4AEAAE12BE', name: 'Cho thuê Midtown M8 2PN Q7', location: 'Quận 7, TP. Hồ Chí Minh', price: 10000000, availability: 'Available', property_type: 'Apartment', transaction_type: 'Rent', price_period: 'Month' }] as never;

describe('output guard: listing codes', () => {
  it('allows building/district words from real listings (Q7, M8, 2PN)', () => {
    expect(outputReason('Căn Midtown M8 2PN tại Q7, mã CFR-79F29F4AEAAE12BE, giá 10.000.000 VND/tháng [1].', evidence, 'Cho thuê căn hộ 2 phòng ngủ Quận 7')).toBeNull();
  });
  it('blocks a listing code that is not among the sources', () => {
    expect(outputReason('Căn RVL-6960B6AB9157C080 rất đẹp [1].', evidence, 'q')).toBe('UNSUPPORTED_PROPERTY');
    expect(outputReason('mã: ZZ99 còn trống [1].', evidence, 'q')).toBe('UNSUPPORTED_PROPERTY');
  });
});

import { groundedSummary, safeReply } from '../src/modules/ai/guard.js';
describe('grounded summary when the model answer stays blocked', () => {
  it('lists the cited listings with live price/status and their [n] numbers', () => {
    const text = groundedSummary([{ ...(evidence as unknown as Record<string, unknown>[])[0], number: 1 } as never]);
    expect(text).toContain('[1] Cho thuê Midtown M8 2PN Q7');
    expect(text).toContain('10.000.000 VND/tháng');
    expect(text).toContain('đang mở bán');
  });
  it('falls back to the safe reply when no listing was retrieved', () => {
    expect(groundedSummary([])).toBe(safeReply);
  });
});
