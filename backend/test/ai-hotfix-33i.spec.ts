import { describe, expect, it } from 'vitest';
import { isPureClosing, searchCriteriaFromHistory } from '../src/modules/ai/history-aware.js';
import { retainUserCriteria } from '../src/modules/ai/criteria-memory.js';
import { deterministicNoMatchReply } from '../src/modules/ai/unsupported.js';

describe('Hotfix 33i regressions', () => {
  it('does not let a model area range enter the two-turn customer criteria', () => {
    const criteria = searchCriteriaFromHistory('2 phòng ngủ', [
      { role: 'user', content: 'mua căn hộ thủ đức dưới 3 tỷ' },
      { role: 'assistant', content: 'Tiêu chí: Căn hộ Mua, ở Thủ Đức, dưới 3 tỷ đồng, từ 50 đến 71 m².' },
    ]);
    const modelFilters = retainUserCriteria({ ...criteria, minArea: 50, maxArea: 71 }, criteria);
    const modelToolFilters = retainUserCriteria({ min_area_m2: 50, max_area_m2: 71 }, criteria);

    expect(criteria).not.toHaveProperty('minArea');
    expect(criteria).not.toHaveProperty('maxArea');
    expect(modelFilters).not.toHaveProperty('minArea');
    expect(modelFilters).not.toHaveProperty('maxArea');
    expect(modelToolFilters).not.toHaveProperty('min_area_m2');
    expect(modelToolFilters).not.toHaveProperty('max_area_m2');
  });

  it('skips the contradictory blocker after exact matches are exhausted', () => {
    const reply = deterministicNoMatchReply({
      area: 'Thủ Đức',
      exactMatchesExhausted: true,
      blocker: 'Ở Thủ Đức, hiện chưa có căn hộ phù hợp với dưới 4 tỷ và tiêu chí 2 phòng ngủ.',
      related: [{ name: 'Căn gần tiêu chí', price: 4_200_000_000, reason: 'Lệch ngân sách' }],
    });

    expect(reply).toContain('Các lựa chọn gần tiêu chí nhất:');
    expect(reply).not.toContain('hiện chưa có căn hộ phù hợp với dưới 4 tỷ');
  });

  it.each([
    'cảm ơn bạn nhiều',
    'cảm ơn bạn rất nhiều',
    'cảm ơn nha',
    'cảm ơn ạ',
    'cảm ơn, mình sẽ liên hệ sau',
    'cảm ơn, để mình suy nghĩ thêm',
    'cảm ơn, hẹn bạn sau',
  ])('recognizes a pure closing: %s', (message) => {
    expect(isPureClosing(message)).toBe(true);
  });

  it.each(['cảm ơn, tìm thêm căn khác', 'cảm ơn, đặt lịch giúp mình'])(
    'rejects a closing with a new request: %s',
    (message) => {
      expect(isPureClosing(message)).toBe(false);
    },
  );
});
