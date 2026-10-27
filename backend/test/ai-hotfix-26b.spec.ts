import { describe, expect, it } from 'vitest';
import { normalizeFinalReply } from '../src/modules/ai/guard.js';

const source = (number: number, extra: Record<string, unknown> = {}) => ({
  availability: 'Available',
  transaction_type: 'Sale',
  updated_at: '2026-10-27T08:30:00.000Z',
  number,
  ...extra,
});

describe('Hotfix 26b final reply guard', () => {
  it('keeps every card in a multi-listing availability answer', () => {
    const reply = [1, 2, 3, 4, 5]
      .map((number) => `- Căn hộ Vinhomes Grand Park, giá 3,${number} tỷ, ${68 + number} m², 2 phòng ngủ [${number}].`)
      .join('\n');
    const result = normalizeFinalReply(
      reply,
      'Căn nào còn bán?',
      [1, 2, 3, 4, 5].map((number) => source(number)),
    );

    expect(result.split('\n')).toHaveLength(5);
    for (const number of [1, 2, 3, 4, 5]) expect(result).toContain(`[${number}]`);
  });

  it('does not treat thực sự alone as an availability question', () => {
    const result = normalizeFinalReply(
      'Căn này có giá 3,2 tỷ. Mình sẽ kiểm tra thêm pháp lý và chi phí trước khi tư vấn.',
      'Căn này thực sự đáng mua không?',
      [source(1, { property_id: 'property-1' })],
    );

    expect(result).toContain('giá 3,2 tỷ');
    expect(result).toContain('kiểm tra thêm pháp lý');
    expect(result).not.toContain('Theo tin đăng');
  });

  it('rewrites only the detail availability sentence and formats its date', () => {
    const result = normalizeFinalReply(
      'Căn này còn bán. Giá 3,2 tỷ. Pháp lý đang cập nhật. Bạn muốn hẹn xem không?',
      'Bạn kiểm tra giúp căn này còn bán không?',
      [source(1, { property_id: 'property-1' })],
    );

    expect(result).toContain('Theo tin đăng, căn này đang ghi là còn bán (cập nhật 27/10/2026).');
    expect(result).toContain('Giá 3,2 tỷ.');
    expect(result).toContain('Pháp lý đang cập nhật.');
    expect(result).toContain('Bạn muốn hẹn xem không?');
    expect(result).not.toContain('2026-10-27');
  });

  it('uses rental availability wording on a rental detail page', () => {
    const result = normalizeFinalReply(
      'Căn này còn không. Giá 12 triệu/tháng. Bạn muốn hẹn xem không?',
      'Căn này còn cho thuê không?',
      [source(1, { property_id: 'property-1', transaction_type: 'Rent' })],
    );

    expect(result).toContain('Theo tin đăng, căn này đang ghi là còn cho thuê (cập nhật 27/10/2026).');
    expect(result).toContain('Giá 12 triệu/tháng.');
  });

  it('does not dedupe similar listing lines with different citations or numbers', () => {
    const reply =
      '- Căn hộ Vinhomes Grand Park, giá 3,2 tỷ, 69 m², 2 phòng ngủ [1].\n- Căn hộ Vinhomes Grand Park, giá 3,1 tỷ, 70 m², 2 phòng ngủ [2].';
    const result = normalizeFinalReply(reply, 'Mình muốn so sánh hai căn này.', [source(1), source(2)]);

    expect(result).toContain('3,2 tỷ');
    expect(result).toContain('3,1 tỷ');
    expect(result).toContain('[1]');
    expect(result).toContain('[2]');
  });

  it('still dedupes near-duplicate legal prose in one paragraph', () => {
    const reply =
      'Pháp lý của căn này chưa được xác nhận; bạn nên kiểm tra giấy tờ gốc và quy hoạch trước khi quyết định. Pháp lý của căn này chưa được xác nhận; bạn nên kiểm tra giấy tờ gốc và quy hoạch trước khi đặt lịch xem.';
    const result = normalizeFinalReply(reply, 'Cho tôi biết thêm về căn này.', []);

    expect(result.match(/Pháp lý của căn này chưa được xác nhận/giu)).toHaveLength(1);
  });

  it('keeps five structured cards with similar names', () => {
    const reply = [1, 2, 3, 4, 5]
      .map((number) => `- Căn hộ Riverside, ${number} phòng ngủ, giá 3,${number} tỷ [${number}].`)
      .join('\n');
    const result = normalizeFinalReply(
      reply,
      'Gửi tôi các căn phù hợp.',
      [1, 2, 3, 4, 5].map((number) => source(number)),
    );

    expect(result.split('\n')).toHaveLength(5);
  });

  it('does not capitalize after Vietnamese abbreviations or inside decimals', () => {
    const result = normalizeFinalReply('TP. hồ chí minh. Giá tham khảo là 3.5 tỷ.', 'Cho tôi thông tin căn này.', []);

    expect(result).toContain('TP. hồ chí minh.');
    expect(result).toContain('3.5 tỷ');
  });
});
