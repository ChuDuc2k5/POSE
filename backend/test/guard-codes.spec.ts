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
    expect(text).toContain('Cho thuê Midtown M8 2PN Q7 ở Quận 7');
    expect(text).toContain('giá 10 triệu đồng/tháng, đang cho thuê [1].');
    expect(text).not.toContain('VND');
  });
  it('falls back to the safe reply when no listing was retrieved', () => {
    expect(groundedSummary([])).toBe(safeReply);
  });
});

import { cheaperFallbackReply } from '../src/modules/ai/unsupported.js';
describe('cheaper budget fallback', () => {
  it('explains the area minimum and offers nearby options without the safe-fail line', () => {
    const reply = cheaperFallbackReply([{ number: 1, name: 'Sunrise Riverside', location: 'Quận 7', price: 11000000 }], 'Quận 7', ['Quận 8', 'Nhà Bè']);
    expect(reply).toContain('chưa tìm thấy căn nào rẻ hơn');
    expect(reply).toContain('11 triệu');
    expect(reply).toContain('Quận 8');
    expect(reply).not.toContain('chưa thể xác nhận câu trả lời an toàn');
  });
});

describe('travel time and distance claims', () => {
  it('blocks an invented travel time', () => {
    expect(outputReason('Căn hộ ở Quận 7, đi Quận 1 mất khoảng 15-30 phút [1].', evidence)).toBe('UNSUPPORTED_TRAVEL');
  });
  it('allows a distance that the retrieved source states', () => {
    expect(outputReason('Căn hộ cách PMH 1.5 km [1].', evidence, '', { sourceText: 'Midtown M8, cách PMH 1.5 km, full nội thất' })).toBeNull();
  });
});

describe('customer-stated travel limits', () => {
  it('allows echoing the travel time the customer asked for', () => {
    expect(outputReason('Hiện chưa có thông tin về thời gian đi làm khoảng 20 phút từ căn này [1].', evidence, 'Tôi muốn thuê căn hộ gần Quận 1, đi làm khoảng 20 phút.')).toBeNull();
  });
});
