import { describe, expect, it } from 'vitest';
import { genericHome, inferSearch } from '../src/modules/ai/infer-search.js';

describe('newest message filters', () => {
  it('reads "thuê nhà" as any home to rent and "mua nhà" as a house', () => {
    expect(genericHome('thuê nhà ở Quận 9')).toBe(true);
    expect(genericHome('thuê nhà nguyên căn ở Bình Thạnh')).toBe(false);
    expect(genericHome('thuê căn hộ ở Quận 7')).toBe(false);
    expect(genericHome('mua nhà ở Gò Vấp')).toBe(false);
    expect(inferSearch('mua nhà ở Gò Vấp')?.type).toBe('House');
  });
  it('states location and transaction from the message itself', () => {
    expect(inferSearch('thuê nhà ở Quận 9')).toMatchObject({ transaction_type: 'Rent', location: 'Quận 9' });
  });
});

import { sourcesFromCitations } from '../src/modules/ai/guard.js';
describe('cards without [n] citations', () => {
  const card = (number: number, code: string, price: number) => ({ number, code, price });
  const sources = [card(1, 'CFR-72DBFF0977244296', 11000000), card(2, 'CFR-AAA1', 23500000), card(3, 'CFR-BBB2', 99000000)];
  it('keeps listings named by catalogue price or code', () => {
    const reply = 'Căn hộ cao cấp Q7 Sài Gòn Riverside, giá 11 triệu đồng/tháng.\nCăn hộ Midtown Q7-PMH, giá 23,5 triệu đồng/tháng.';
    expect(sourcesFromCitations(reply, sources).map(s => s.code)).toEqual(['CFR-72DBFF0977244296', 'CFR-AAA1']);
    expect(sourcesFromCitations('Xem căn CFR-BBB2 nhé.', sources).map(s => s.code)).toEqual(['CFR-BBB2']);
  });
  it('still shows no card for a reply that names none', () => {
    expect(sourcesFromCitations('Hiện chưa có căn phù hợp.', sources)).toEqual([]);
  });
});

import { clarificationFor, missingBudgetQuestion, referencedListingCodes } from '../src/modules/ai/history-aware.js';
describe('picking a listing that was just shown', () => {
  const history = [{ role: 'user', content: 'Cho thuê căn hộ 2 phòng ngủ Quận 7' }, { role: 'assistant', content: 'Có 5 căn ở Quận 7.\nMã: CFR-AAA11111, CFR-BBB22222' }];
  const message = 'tôi quan tâm căn này\nCăn hộ 2 phòng ngủ tại CC Midtown Phú Mỹ Hưng, giá 26 triệu đồng/tháng.';
  it('does not ask for the area again', () => {
    expect(clarificationFor(message, history).needed).toBe(false);
  });
  it('treats "quan tâm" as a reference to the listings just shown', () => {
    expect(referencedListingCodes(message, history)).toEqual({ codes: ['CFR-AAA11111', 'CFR-BBB22222'], ambiguous: true });
  });
});

describe('search clarification', () => {
  it('asks for area and budget before a first broad search', () => {
    const result = clarificationFor('Tôi muốn thuê chung cư', []);
    expect(result.needed).toBe(true);
    expect(result.options).toContain('Chưa rõ, gợi ý giúp tôi');
  });
  it('asks for the area when only a budget is supplied', () => {
    expect(clarificationFor('Tìm căn hộ dưới 3 tỷ', []).needed).toBe(true);
  });
  it('does not block an area search and adds a budget prompt', () => {
    expect(clarificationFor('Thuê căn hộ ở Quận 7', []).needed).toBe(false);
    expect(missingBudgetQuestion('Thuê căn hộ ở Quận 7', [])).toMatch(/ngân sách thuê/i);
  });
  it('does not loop after a vague clarification reply', () => {
    expect(clarificationFor('Chưa rõ, gợi ý giúp tôi', [{ role: 'assistant', content: 'Bạn muốn khu vực nào?' }]).needed).toBe(false);
  });
  it('moves a cheaper follow-up below the previous result range', async () => {
    const { budgetFollowUp } = await import('../src/modules/ai/history-aware.js');
    const result = budgetFollowUp('Có căn nào rẻ hơn không?', [
      { role: 'user', content: 'Tôi muốn thuê chung cư Quận 7 khoảng 15 triệu' },
      { role: 'assistant', content: 'Mình tìm thấy mức khoảng 15 triệu.', sources: [{ price: 14000000 }, { price: 16000000 }] },
    ]);
    expect(result?.direction).toBe('cheaper');
    expect(result?.filters.maxPrice).toBeLessThan(14000000);
  });
  it('moves a higher follow-up above the previous result range', async () => {
    const { budgetFollowUp } = await import('../src/modules/ai/history-aware.js');
    const result = budgetFollowUp('Cao cấp hơn chút', [
      { role: 'user', content: 'Tôi muốn thuê chung cư Quận 7 khoảng 15 triệu' },
      { role: 'assistant', content: 'Mình tìm thấy mức khoảng 15 triệu.', sources: [{ price: 14000000 }, { price: 16000000 }] },
    ]);
    expect(result?.direction).toBe('higher');
    expect(result?.filters.minPrice).toBeGreaterThan(16000000);
  });
});

import { isAbusive } from '../src/modules/ai/guard.js';
describe('abusive messages and refusals', () => {
  it('flags vulgar messages but not ordinary property words', () => {
    expect(isAbusive('tao muốn địt gái gia lai')).toBe(true);
    expect(isAbusive('đm sao chậm thế')).toBe(true);
    expect(isAbusive('Nhà này có sổ đỏ không, đường trước nhà rộng bao nhiêu?')).toBe(false);
    expect(isAbusive('Có nhà gần chợ Đà Lạt không?')).toBe(false);
  });
  it('drops cards from a refusal even for a referenced listing', () => {
    const card = [{ number: 1, code: 'RVL-69B7C6BB8461439E', price: 7000000000 }];
    expect(sourcesFromCitations('Tôi rất tiếc, tôi không thể hỗ trợ yêu cầu này. Nếu bạn cần tư vấn về bất động sản, tôi sẵn sàng giúp bạn.', card, true)).toEqual([]);
    expect(sourcesFromCitations('Căn này giá 7 tỷ, chưa có thông tin về sổ hồng.', card, true)).toEqual(card);
  });
});

describe('booking a named listing', () => {
  it('never asks for the area again', () => {
    const history = [{ role: 'user', content: 'thuê nhà ở Quận 9' }, { role: 'assistant', content: 'Có 1 căn ở Quận 9.' }];
    expect(clarificationFor('Đặt lịch xem căn RVL-69B7C6BB8461439E', history).needed).toBe(false);
    expect(clarificationFor('Tôi muốn đặt lịch xem nhà', history).needed).toBe(false);
  });
});

describe('project and ward names count as a location', () => {
  const history = [{ role: 'user', content: 'thuê nhà ở Quận 9' }, { role: 'assistant', content: 'Có 1 căn ở Quận 9.' }];
  it('does not ask for the area again', () => {
    expect(clarificationFor('Bán căn hộ studio Vinhomes Grand Park dưới 2 tỷ', history).needed).toBe(false);
    expect(clarificationFor('Thuê căn hộ ở Phú Mỹ Hưng', history).needed).toBe(false);
    expect(clarificationFor('Mua nhà phường Long Bình', history).needed).toBe(false);
    expect(clarificationFor('Thuê căn hộ giá 10 triệu', history).needed).toBe(true);
  });
});
