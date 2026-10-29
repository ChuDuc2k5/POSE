import { describe, expect, it } from 'vitest';
import { cardComparisonReply } from '../src/modules/ai/comparison.js';
import { derivedFinanceAmounts } from '../src/modules/ai/finance.js';
import { clarificationFor, isPureClosing, searchCriteriaFromHistory } from '../src/modules/ai/history-aware.js';
import { nearestReasonForReply, nearestRelaxationStages } from '../src/modules/ai/nearest.js';
import {
  disclosure,
  dedupeCriteriaLines,
  normalizeFinalReply,
  outputReason,
  removeFutureListingPromise,
} from '../src/modules/ai/guard.js';
import { deterministicNoMatchReply, genericQuestionFallback } from '../src/modules/ai/unsupported.js';
import { mergeCriteria } from '../src/modules/ai/criteria-memory.js';

describe('Hotfix 33h reply quality', () => {
  it('discloses only once when an assistant turn already exists and strips a mid-conversation greeting', () => {
    const first = normalizeFinalReply(disclosure, 'tìm căn hộ', [], { nonFirstTurn: false });
    const later = normalizeFinalReply('Chào Quận, mình đã tìm được căn phù hợp.', 'tiếp tục', [], {
      nonFirstTurn: true,
    });
    const named = normalizeFinalReply('Chào bạn Lan, mình đã tìm được căn phù hợp.', 'ở thủ đức', [], {
      nonFirstTurn: true,
    });
    expect(first).toBe(disclosure);
    expect(later).toBe('Mình đã tìm được căn phù hợp.');
    expect(named).toContain('Lan');
  });

  it('accepts loan examples that are percentages of a price the customer already saw', () => {
    const reply =
      'Với thu nhập 25 triệu đồng/tháng, bạn có thể vay khoảng 50% đến 70% giá trị căn nhà. Ví dụ căn giá 1,85 tỷ đồng, bạn có thể vay khoảng từ 925 triệu đến 1,3 tỷ đồng.';
    expect(
      outputReason(reply, [], 'vay thêm được không, thu nhập 25 triệu', {
        retrievalFound: false,
        previousPrices: [1_850_000_000],
      }),
    ).not.toBe('UNSUPPORTED_PRICE');
    expect(
      outputReason('Bạn có thể vay khoảng 70%, ví dụ căn giá 4,2 tỷ đồng.', [], 'vay thêm được không', {
        retrievalFound: false,
        previousPrices: [1_850_000_000],
      }),
    ).not.toBeNull();
  });

  it('keeps exactly one criteria line when model and server both emit one', () => {
    expect(
      dedupeCriteriaLines('Tiêu chí: ở Quận 9, tối đa 8 tỷ.\nTiêu chí: ở Quận 9, dưới 8 tỷ.\nMình gửi căn phù hợp.'),
    ).toBe('Tiêu chí: ở Quận 9, tối đa 8 tỷ.\nMình gửi căn phù hợp.');
  });

  it('uses the exhausted-match explanation and a grammatical budget-miss reason', () => {
    expect(
      deterministicNoMatchReply({
        area: 'Quận 7',
        exactMatchesExhausted: true,
        related: [{ name: 'Căn gần tiêu chí', price: 12_000_000, reason: 'giá vượt ngân sách đã nêu' }],
      }),
    ).toContain('Mình đã gửi hết các căn khớp đủ tiêu chí hiện có ở Quận 7.');
    expect(nearestRelaxationStages({ maxPrice: 10_000_000 }, true)[0].reason).toBe('Ngoài ngân sách đã nêu');
    expect(nearestReasonForReply('Ngoài ngân sách đã nêu')).toBe('giá vượt ngân sách đã nêu');
  });

  it('replaces a false future-listing promise when the result set did not change', () => {
    expect(removeFutureListingPromise('Mình sẽ cập nhật và gửi danh sách các căn mới sớm nhất.')).toBe('');
  });

  it('does not preserve an area that only appeared in an assistant-written criteria line', () => {
    const history = [
      { role: 'user', content: 'Thuê căn hộ ở Quận 9 dưới 10 triệu' },
      { role: 'assistant', content: 'Tiêu chí: ở Quận 9, dưới 10 triệu, từ 50 đến 70 m².' },
    ];
    expect(searchCriteriaFromHistory('2 phòng ngủ', history)).not.toHaveProperty('minArea');
    expect(searchCriteriaFromHistory('2 phòng ngủ', history)).not.toHaveProperty('maxArea');
  });

  it('keeps studio relaxation broad and widens a set bedroom criterion', () => {
    expect(mergeCriteria({ transaction_type: 'Rent', type: 'Apartment' }, 'studio cũng được')).toEqual({
      transaction_type: 'Rent',
      type: 'Apartment',
    });
    expect(mergeCriteria({ transaction_type: 'Rent', bedrooms: 2 }, '1 phòng ngủ cũng được')).toMatchObject({
      minBedrooms: 1,
      maxBedrooms: 2,
    });
  });

  it('derives finance amounts from stated income and percentages but not invented listing prices', () => {
    expect(derivedFinanceAmounts('vay thêm, thu nhập 25 triệu, dùng 40% trong 12 tháng', [])).toEqual(
      expect.arrayContaining([10_000_000, 120_000_000]),
    );
    expect(
      outputReason('Khoản trả tham khảo khoảng 10 triệu đồng/tháng.', [], 'vay thêm, thu nhập 25 triệu, dùng 40%', {
        retrievalFound: false,
        financeAmounts: [10_000_000],
        financePresent: true,
      }),
    ).toBeNull();
    expect(
      outputReason('Giá căn khoảng 1 tỷ đồng.', [], 'vay thêm, thu nhập 25 triệu', {
        retrievalFound: false,
        financeAmounts: [10_000_000],
        financePresent: true,
      }),
    ).toBe('NO_ANSWER_UNGROUNDED');
    expect(outputReason('Căn này có 2 phòng ngủ theo tiêu chí đã nhớ.', [], '', { criteriaBedrooms: [2] })).toBeNull();
  });

  it('does not block negated or check-context commitment language', () => {
    expect(
      outputReason('TERAVA không có cam kết giữ nguyên giá; hãy kiểm tra chính sách và hợp đồng.', [], ''),
    ).toBeNull();
    expect(genericQuestionFallback()).toContain('không cam kết hay bảo đảm giá');
    expect(
      outputReason('TERAVA không cam kết giữ giá, nhưng mình cam kết căn này sẽ tăng giá 20%.', [], ''),
    ).not.toBeNull();
  });

  it('answers a pure closing without asking another refinement question', () => {
    expect(isPureClosing('Cảm ơn bạn nhé')).toBe(true);
    expect(isPureClosing('Cảm ơn, tìm thêm căn khác')).toBe(false);
    expect(clarificationFor('minh muon thue can ho', []).needed).toBe(true);
  });

  it('renders the comparison in Vietnamese with concise legal and feature fields', () => {
    const reply = cardComparisonReply([
      {
        number: 1,
        name: 'Căn hộ Quận 9',
        price: 2_000_000_000,
        area: 50,
        bedrooms: 0,
        location: 'Quận 9',
        description: 'Sổ hồng sẵn. Ban công thoáng.',
        transaction_type: 'Sale',
      },
      {
        number: 2,
        name: 'Căn hộ Quận 9 khác',
        price: 2_400_000_000,
        area: 60,
        bedrooms: 2,
        location: 'Quận 9',
        description: 'Gần công viên.',
        transaction_type: 'Sale',
      },
    ] as never);
    expect(reply).toContain('So sánh hai căn theo đúng số thứ tự');
    expect(reply).toContain('Pháp lý sổ hồng sẵn');
    expect(reply).toContain('Điểm nổi bật Gần công viên');
    expect(reply).not.toContain('Features');
    expect(reply).toContain('Khác biệt chính:');
  });
});
