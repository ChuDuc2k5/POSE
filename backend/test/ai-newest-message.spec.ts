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

import { clarificationFor, referencedListingCodes } from '../src/modules/ai/history-aware.js';
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
