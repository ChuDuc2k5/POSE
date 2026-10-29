import { describe, expect, it } from 'vitest';
import {
  isListedCardFollowUp,
  mergeCriteria,
  nextCriteriaQuestion,
  validCriteria,
} from '../src/modules/ai/criteria-memory.js';
import { inferSearch } from '../src/modules/ai/infer-search.js';
import { nearestRelaxationStages } from '../src/modules/ai/nearest.js';
import { hasCatalogueNoMatchReply, hasNoMatchReply } from '../src/modules/ai/unsupported.js';

describe('Hotfix 33 criteria memory', () => {
  const saleApartment = {
    transaction_type: 'Sale' as const,
    type: 'Apartment',
    location: 'Thủ Đức',
    maxPrice: 3_000_000_000,
    bedrooms: 2,
  };

  it.each([
    ['area switch keeps the rest', saleApartment, 'ở quận 7', { ...saleApartment, location: 'Quận 7' }],
    [
      'type switch keeps area and budget',
      saleApartment,
      'thôi tôi muốn mua nhà phố, tầm 5 tỷ',
      { ...saleApartment, type: 'House', maxPrice: 5_500_000_000 },
    ],
    [
      'transaction switch clears incompatible budget',
      saleApartment,
      'à không, tôi muốn thuê',
      { location: 'Thủ Đức', type: 'Apartment', transaction_type: 'Rent', bedrooms: 2 },
    ],
    [
      'correction replaces only the corrected field',
      { ...saleApartment, location: 'Quận 9' },
      'à nhầm, ý mình là quận 7',
      { ...saleApartment, location: 'Quận 7' },
    ],
    [
      'bedroom relaxation removes the bedroom field',
      saleApartment,
      '1 phòng ngủ cũng được',
      { ...saleApartment, bedrooms: undefined, minBedrooms: 1, maxBedrooms: 2 },
    ],
  ])('%s', (_name, previous, message, expected) => {
    expect(mergeCriteria(previous, message)).toEqual(
      Object.fromEntries(Object.entries(expected).filter(([, value]) => value !== undefined)),
    );
  });

  it('replaces every field for an explicit full search', () => {
    expect(mergeCriteria(saleApartment, 'mua căn hộ thủ đức dưới 3 tỷ')).toEqual({
      transaction_type: 'Sale',
      type: 'Apartment',
      location: 'Thủ Đức',
      maxPrice: 3_000_000_000,
      maxPriceExclusive: true,
    });
  });

  it('parses an ASCII monthly budget without asking to clarify', () => {
    expect(inferSearch('o quan 9 duoi 9 trieu')).toMatchObject({
      location: 'Quận 9',
      maxPrice: 9_000_000,
      maxPriceExclusive: true,
    });
  });

  it.each([
    ['5-8 triệu', { minPrice: 5_000_000, maxPrice: 8_000_000 }],
    ['từ 2 đến 3 tỷ', { minPrice: 2_000_000_000, maxPrice: 3_000_000_000 }],
    ['2,5–3 tỷ', { minPrice: 2_500_000_000, maxPrice: 3_000_000_000 }],
  ])('merges an inclusive budget range: %s', (message, budget) => {
    expect(mergeCriteria({ ...saleApartment, transaction_type: 'Rent', maxPriceExclusive: true }, message)).toEqual({
      ...saleApartment,
      transaction_type: 'Rent',
      ...budget,
    });
  });

  it('replaces an earlier exclusive ceiling with an inclusive range', () => {
    const below = mergeCriteria({ ...saleApartment, transaction_type: 'Rent' }, 'dưới 9 triệu');
    expect(mergeCriteria(below, '5-8 triệu')).toEqual({
      ...saleApartment,
      transaction_type: 'Rent',
      minPrice: 5_000_000,
      maxPrice: 8_000_000,
    });
  });

  it('keeps the first area after twelve turns when criteria is echoed', () => {
    let criteria = mergeCriteria({}, 'thuê căn hộ ở quận 9');
    for (const message of [
      'dưới 10 triệu',
      '2 phòng ngủ',
      'có căn nào khác không',
      'tăng lên 12 triệu',
      'bình thạnh có không',
      'về thủ đức',
      'dưới 11 triệu',
      '1 phòng ngủ cũng được',
      'có căn nào khác không',
      'tìm căn rẻ nhất',
      'vẫn ở quận 9 nhé',
    ])
      criteria = mergeCriteria(criteria, message);
    expect(criteria.location).toBe('Quận 9');
  });

  it('accepts only normalized criteria fields', () => {
    expect(validCriteria({ location: 'Quận 9', maxPrice: 9_000_000 })).toBe(true);
    expect(validCriteria({ location: 'Quận 9', exclude_ids: ['x'] })).toBe(false);
    expect(validCriteria({ minPrice: 10, maxPrice: 1 })).toBe(false);
  });

  it('does not treat missing listing facts as a no-match reply', () => {
    expect(hasNoMatchReply('Tin đăng chưa có thông tin về pháp lý [1].')).toBe(false);
    expect(hasCatalogueNoMatchReply('Tôi chưa có đủ thông tin để xác nhận giá này.')).toBe(false);
    expect(hasNoMatchReply('Hiện chưa có căn nào đáp ứng đủ tiêu chí của bạn.')).toBe(true);
    expect(hasCatalogueNoMatchReply('Hiện chưa có căn nào đáp ứng đủ tiêu chí của bạn.')).toBe(true);
  });

  it('keeps search criteria for finance and detail questions about listed cards', () => {
    const history = [{ role: 'assistant', content: '[1] Căn hộ Quận 9', sources: [{ id: 'one' }] }];
    expect(isListedCardFollowUp('nếu căn này khoảng 5 tỷ thì vay thế nào', history)).toBe(true);
    expect(isListedCardFollowUp('căn số 1 có sổ hồng không', history)).toBe(true);
  });

  it('stages budget and area, then refines only missing secondary criteria', () => {
    expect(nextCriteriaQuestion({ transaction_type: 'Rent', location: 'Quận 9' })).toMatchObject({
      needed: true,
      options: ['Dưới 10 triệu', '10–20 triệu', 'Chưa rõ, gợi ý giúp tôi'],
    });
    expect(nextCriteriaQuestion({ transaction_type: 'Rent', maxPrice: 10_000_000 })).toMatchObject({
      needed: true,
      options: ['Quận 7', 'Bình Thạnh', 'Thủ Đức', 'Chưa rõ, gợi ý giúp tôi'],
    });
    expect(nextCriteriaQuestion({ transaction_type: 'Rent', location: 'Quận 9', maxPrice: 10_000_000 })).toMatchObject({
      needed: false,
      refine: {
        options: ['1 PN', '2 PN', '3 PN+', 'Dưới 50 m²', '50–80 m²', 'Trên 80 m²'],
      },
    });
    expect(
      nextCriteriaQuestion({ transaction_type: 'Rent', location: 'Quận 9', maxPrice: 10_000_000, bedrooms: 2 }),
    ).toMatchObject({
      needed: false,
      refine: { options: ['Dưới 50 m²', '50–80 m²', 'Trên 80 m²'] },
    });
    expect(
      nextCriteriaQuestion({
        transaction_type: 'Rent',
        location: 'Quận 9',
        maxPrice: 10_000_000,
        bedrooms: 2,
        minArea: 50,
      }),
    ).toEqual({ needed: false, question: null, options: [] });
  });

  it('prioritizes near matches that relax bedrooms or area and labels the miss', () => {
    const stages = nearestRelaxationStages(
      {
        transaction_type: 'Rent',
        location: 'Quận 9',
        maxPrice: 10_000_000,
        bedrooms: 3,
        minArea: 60,
      },
      true,
    );
    expect(stages[0]).toMatchObject({ reason: 'Lệch tiêu chí: số phòng ngủ' });
    expect(stages[0].filters).not.toHaveProperty('bedrooms');
    expect(stages[1]).toMatchObject({ reason: 'Lệch tiêu chí: diện tích' });
    expect(stages[1].filters).not.toHaveProperty('minArea');
  });
});
