import { describe, expect, it } from 'vitest';
import { clarificationFor } from '../src/modules/ai/history-aware.js';
import { inferSearch, inferTransactionType } from '../src/modules/ai/infer-search.js';
import { priceComparisonQuestion } from '../src/modules/ai/market.js';
import { discardInvalidCitations, outputReason } from '../src/modules/ai/guard.js';
import { lowestPriced } from '../src/modules/ai/nearest.js';
import { ruleSimilarProperties } from '../src/modules/ai/similar.js';
import { contactRequest, loanWords, ownerRequest } from '../src/modules/ai/unsupported.js';

describe('Hotfix 7 FAQ 51-100 routing', () => {
  it('drops an out-of-range citation without losing the grounded sentence', () => {
    expect(
      discardInvalidCitations('Căn này có ban công [1]. Tin đăng chưa có thông tin về hồ bơi [6].', [{ number: 1 }]),
    ).toBe('Căn này có ban công [1].');
    expect(discardInvalidCitations('Căn này có ban công [1] và giá tốt [6].', [{ number: 1 }])).toBe(
      'Căn này có ban công [1] và giá tốt.',
    );
  });

  it('accepts a travel distance when only whitespace differs from the source', () => {
    expect(
      outputReason(
        'Căn hộ cách trường học 1 km [1].',
        [
          {
            number: 1,
            id: 'one',
            code: 'A-1',
            name: 'Căn hộ',
            location: 'Quận 7',
            price: null,
            availability: 'Available',
          } as never,
        ],
        '',
        { sourceText: 'Căn hộ cách trường học 1km.' },
      ),
    ).toBeNull();
  });

  it('chooses the three cheapest budget-only fallback listings', () => {
    expect(lowestPriced([{ price: 900 }, { price: 300 }, { price: 500 }, { price: 100 }])).toEqual([
      { price: 100 },
      { price: 300 },
      { price: 500 },
    ]);
  });

  it('treats concrete features as searchable criteria and keeps type/transaction', () => {
    expect(clarificationFor('Có căn hộ nào đang bán mà được nhận nhà ngay không?', [])).toMatchObject({
      needed: false,
    });
    expect(inferSearch('Có căn hộ nào đang bán mà được nhận nhà ngay không?')).toMatchObject({
      type: 'Apartment',
      transaction_type: 'Sale',
    });
    expect(inferSearch('Mình muốn thuê căn hộ có sẵn máy lạnh và máy giặt')).toMatchObject({
      type: 'Apartment',
      transaction_type: 'Rent',
    });
    expect(inferSearch('Bên mình có căn hộ nào đang giảm giá không?')?.keywords).toContain('giảm giá');
  });

  it('does not turn advice, process, or service questions into clarification-only searches', () => {
    expect(clarificationFor('Mình mới tìm hiểu về bất động sản, bên mình có thể tư vấn giúp không?', [])).toMatchObject(
      { needed: false },
    );
    expect(clarificationFor('Mình muốn mua nhà lần đầu thì nên bắt đầu từ đâu?', [])).toMatchObject({ needed: false });
    expect(clarificationFor('Bên mình có hỗ trợ làm thủ tục mua bán nhà đất không?', [])).toMatchObject({
      needed: false,
    });
    expect(clarificationFor('Hiện tại bên mình có những căn hộ nào đang cho thuê?', [])).toMatchObject({
      needed: false,
    });
  });

  it('recognizes catalogue availability questions as buyer intent', () => {
    expect(ownerRequest('Bên mình có nhà nào đang bán ở Thủ Đức không?')).toBe(false);
    expect(ownerRequest('Bên mình có bán nhà phố trong khu dân cư không?')).toBe(false);
    expect(ownerRequest('Tôi muốn bán nhà ở Quận 7')).toBe(true);
  });

  it('infers sale from billion pricing and retains comparison focus', () => {
    expect(inferTransactionType('Có nhà nào ở Quận 7 giá dưới 5 tỷ không bạn?')).toBe('Sale');
    expect(priceComparisonQuestion('Giá căn hộ này so với các căn khác có cao không?')).toBe(true);
  });

  it('keeps only same-type, same-transaction, same-district, ±30% similar listings', () => {
    const source = {
      id: 'source',
      district: 'Quận 9 cũ',
      property_type: 'Apartment',
      transaction_type: 'Sale',
      price: 3_000_000_000,
    };
    expect(
      ruleSimilarProperties(source, [
        {
          id: 'same',
          district: 'Quận 9 cũ',
          property_type: 'Apartment',
          transaction_type: 'Sale',
          price: 3_500_000_000,
        },
        {
          id: 'far',
          district: 'Quận 7 cũ',
          property_type: 'Apartment',
          transaction_type: 'Sale',
          price: 3_000_000_000,
        },
        {
          id: 'rent',
          district: 'Quận 9 cũ',
          property_type: 'Apartment',
          transaction_type: 'Rent',
          price: 3_000_000_000,
        },
        {
          id: 'expensive',
          district: 'Quận 9 cũ',
          property_type: 'Apartment',
          transaction_type: 'Sale',
          price: 4_000_000_000,
        },
      ]),
    ).toEqual([
      { id: 'same', district: 'Quận 9 cũ', property_type: 'Apartment', transaction_type: 'Sale', price: 3_500_000_000 },
    ]);
  });

  it('recognizes contact requests without accepting phone numbers in chat', () => {
    expect(contactRequest('Mình muốn để lại số điện thoại để được tư vấn thì làm thế nào?')).toBe(true);
    expect(loanWords('Mua nhà trả góp được không?')).toBe(true);
  });
});
