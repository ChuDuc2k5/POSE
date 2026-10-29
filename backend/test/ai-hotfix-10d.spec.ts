import { describe, expect, it } from 'vitest';
import { areaAdviceQuestion } from '../src/modules/ai/market.js';
import { groupAreaRows } from '../src/modules/ai/catalogue-overview.js';
import { inferSearch } from '../src/modules/ai/infer-search.js';

describe('hotfix 10d budgeted area advice', () => {
  it('recognizes a budgeted where-to-buy question as a Sale ceiling', () => {
    const message = 'Tôi có 2 tỷ, nên mua BĐS ở đâu?';
    expect(areaAdviceQuestion(message)).toBe(true);
    expect(inferSearch(message)).toMatchObject({
      transaction_type: 'Sale',
      maxPrice: 2_000_000_000,
      maxPriceExclusive: false,
    });
  });

  it('keeps an apartment type filter with an 800-million ceiling', () => {
    expect(inferSearch('Tôi chỉ có 800 triệu, mua căn hộ ở đâu được?')).toMatchObject({
      type: 'Apartment',
      transaction_type: 'Sale',
      maxPrice: 800_000_000,
      maxPriceExclusive: false,
    });
  });

  it('parses a bare budget for a later area-chip search', () => {
    expect(inferSearch('có 2 tỷ')).toMatchObject({
      transaction_type: 'Sale',
      maxPrice: 2_000_000_000,
      maxPriceExclusive: false,
    });
    expect(inferSearch('Thủ Đức')).toMatchObject({ location: 'Thủ Đức' });
  });

  it('recognizes every supported budget wording as a maximum', () => {
    for (const wording of ['có 2 tỷ', 'chỉ có 2 tỷ', 'trong tay 2 tỷ', 'vốn 2 tỷ', 'tài chính 2 tỷ']) {
      expect(inferSearch(wording), wording).toMatchObject({ maxPrice: 2_000_000_000, maxPriceExclusive: false });
    }
  });

  it('groups the live ward sample into former-district labels', () => {
    expect(
      groupAreaRows([
        {
          label: 'Phường Long Bình, Thành phố Hồ Chí Minh',
          count: 62,
          min_price: 1_200_000_000,
          max_price: 2_000_000_000,
        },
        { label: 'Thủ Đức', count: 53, min_price: 900_000_000, max_price: 1_800_000_000 },
        { label: 'Phường Thới An, Thành phố Hồ Chí Minh', count: 29, min_price: 700_000_000, max_price: 1_400_000_000 },
      ]),
    ).toEqual([
      { label: 'Thủ Đức', count: 115, min_price: 900_000_000, max_price: 2_000_000_000 },
      { label: 'Quận 12', count: 29, min_price: 700_000_000, max_price: 1_400_000_000 },
    ]);
  });
});
