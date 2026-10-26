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

import { clarificationFor, missingBudgetQuestion, referencedListingCodes, searchCriteriaFromHistory } from '../src/modules/ai/history-aware.js';
import { ownerRequest, ownerValuationQuestion, listingFollowUpFallback } from '../src/modules/ai/unsupported.js';
import { explicitWriteIntent } from '../src/modules/ai/guard.js';
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
  it('searches concrete criteria even when area and budget are absent', () => {
    expect(clarificationFor('Tôi cần mua nhà diện tích khoảng 80 m², có 2 phòng ngủ.', []).needed).toBe(false);
    expect(clarificationFor('Tôi muốn thuê nhà đầy đủ nội thất trong 6 tháng.', []).needed).toBe(false);
  });
  it('asks for area and budget before a first broad search', () => {
    const result = clarificationFor('Tôi muốn thuê chung cư', []);
    expect(result.needed).toBe(true);
    expect(result.options).toContain('Chưa rõ, gợi ý giúp tôi');
  });
  it('searches when only a budget is supplied', () => {
    expect(clarificationFor('Tìm căn hộ dưới 3 tỷ', []).needed).toBe(false);
  });
  it('asks for the area after a budget chip in a clarification flow', () => {
    const history = [
      { role: 'user', content: 'Tôi muốn thuê nhà' },
      { role: 'assistant', content: 'Bạn đang tìm nhà thuê ở khu vực nào và ngân sách khoảng bao nhiêu mỗi tháng ạ?' },
    ];
    const result = clarificationFor('Dưới 10 triệu', history);
    expect(result).toMatchObject({ needed: true });
    expect(result.question).toMatch(/khu vực/iu);
    expect(result.options).toEqual(['Quận 7', 'Bình Thạnh', 'Thủ Đức', 'Chưa rõ, gợi ý giúp tôi']);
  });
  it('accepts an area after the budget chip without listing before the area is known', () => {
    const history = [
      { role: 'user', content: 'Tôi muốn thuê nhà' },
      { role: 'assistant', content: 'Bạn đang tìm nhà thuê ở khu vực nào và ngân sách khoảng bao nhiêu mỗi tháng ạ?' },
      { role: 'user', content: 'Dưới 10 triệu' },
      { role: 'assistant', content: 'Bạn muốn thuê ở khu vực nào (quận/phường)? Nếu chưa chắc, mình gợi ý vài khu nhé.' },
    ];
    expect(clarificationFor('Ở Quận 9', history).needed).toBe(false);
    expect(searchCriteriaFromHistory('Ở Quận 9', history)).toMatchObject({ transaction_type: 'Rent', maxPrice: 10000000, location: 'Quận 9' });
  });
  it('searches without an area when the area answer is vague', () => {
    const history = [
      { role: 'user', content: 'Tôi muốn thuê nhà' },
      { role: 'assistant', content: 'Bạn muốn thuê ở khu vực nào (quận/phường)? Nếu chưa chắc, mình gợi ý vài khu nhé.' },
      { role: 'user', content: 'Dưới 10 triệu' },
    ];
    expect(clarificationFor('Chưa rõ, gợi ý giúp tôi', history).needed).toBe(false);
    expect(searchCriteriaFromHistory('Chưa rõ, gợi ý giúp tôi', history)).toMatchObject({ transaction_type: 'Rent', maxPrice: 10000000 });
    expect(searchCriteriaFromHistory('Chưa rõ, gợi ý giúp tôi', history).location).toBeUndefined();
  });
  it('asks for budget after an area-only answer in the first clarification flow', () => {
    const history = [
      { role: 'user', content: 'Tôi muốn mua căn hộ' },
      { role: 'assistant', content: 'Bạn đang tìm mua căn hộ ở khu vực nào và ngân sách khoảng bao nhiêu ạ?' },
    ];
    const result = clarificationFor('Quận 7', history);
    expect(result).toMatchObject({ needed: true });
    expect(result.question).toMatch(/ngân sách/iu);
    expect(result.options).toEqual(['Dưới 3 tỷ', '3–6 tỷ', 'Chưa rõ, gợi ý giúp tôi']);
  });
  it('resets old rent budget for an explicit new purchase search', () => {
    const history = [
      { role: 'user', content: 'Tôi muốn thuê nhà dưới 10 triệu ở Quận 9' },
      { role: 'assistant', content: 'Mình đã tìm thấy các căn phù hợp.' },
    ];
    expect(searchCriteriaFromHistory('Tìm nhà mua ở Quận 7', history)).toMatchObject({ transaction_type: 'Sale', type: 'House', location: 'Quận 7' });
    expect(searchCriteriaFromHistory('Tìm nhà mua ở Quận 7', history).maxPrice).toBeUndefined();
  });
  it('searches immediately when all criteria are in one message', () => {
    expect(clarificationFor('Thuê nhà Quận 7 dưới 15 triệu', []).needed).toBe(false);
    expect(searchCriteriaFromHistory('Thuê nhà Quận 7 dưới 15 triệu', [])).toMatchObject({ transaction_type: 'Rent', type: 'House', location: 'Quận 7', maxPrice: 15000000 });
  });
  it('answers a follow-up about the listing in history instead of clarifying', () => {
    expect(clarificationFor('Tiền cọc mấy tháng và hợp đồng thuê tối thiểu bao lâu?', [{ role: 'user', content: 'Chi tiết căn CFR-0FC7C10BB520419B' }]).needed).toBe(false);
  });
  it('keeps the property type the customer named', () => {
    expect(clarificationFor('Tôi muốn thuê nhà', []).question).toContain('nhà thuê');
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

describe('seller and viewing intents', () => {
  it('does not route owners into buyer clarification', () => {
    expect(ownerRequest('Tôi muốn cho thuê nhà nhưng không muốn tự quản lý khách thuê.')).toBe(true);
    expect(clarificationFor('Tôi muốn cho thuê nhà của mình.', []).needed).toBe(false);
  });
  it('recognizes direct viewing as an action turn', () => {
    expect(explicitWriteIntent('Tôi muốn xem trực tiếp căn CFR-0FC7C10BB520419B vào chiều thứ Bảy.')).toBe(true);
  });
  it('recognizes direct owner sale wording and valuation questions', () => {
    expect(ownerRequest('Tôi muốn bán nhà trong vòng 3 tháng.')).toBe(true);
    expect(ownerValuationQuestion('Giá cho thuê 15 triệu có hợp lý không?')).toBe(true);
  });
  it('keeps a listing follow-up grounded when the answer needs a fallback', () => {
    const reply = listingFollowUpFallback([{ number: 1, name: 'Căn Midtown', price: 11000000, transaction_type: 'Rent', price_period: 'Month' }], 'phí quản lý, gửi xe, điện nước');
    expect(reply).toContain('[1]');
    expect(reply).toContain('11');
    expect(reply).toContain('chưa có thông tin');
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
