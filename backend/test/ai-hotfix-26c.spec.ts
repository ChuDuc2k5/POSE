import { describe, expect, it } from 'vitest';
import { assembleFinalReply, normalizeFinalReply } from '../src/modules/ai/guard.js';

const source = (number = 1, extra: Record<string, unknown> = {}) => ({
  availability: 'Available',
  transaction_type: 'Sale',
  updated_at: '2026-10-27T08:30:00.000Z',
  number,
  ...extra,
});

describe('Hotfix 26c structural reply assembly', () => {
  it('never returns an intro-only reply when the model body was non-empty', () => {
    expect(
      assembleFinalReply({
        intro: 'INTRO',
        body: '',
        originalBody: 'Original sanitized model body.',
        fallbackNotice: 'Canonical notice.',
      }),
    ).toBe('INTRO\nCanonical notice.\nOriginal sanitized model body.');
  });

  it('puts the intro before every system notice and the model body', () => {
    expect(
      assembleFinalReply({
        intro: 'Tôi là trợ lý AI của TERAVA.',
        notices: [
          'Theo tin đăng, căn này đang ghi là còn bán (cập nhật 27/10/2026).',
          'Không có khoản đầu tư nào không có rủi ro.',
          'Tiêu chí: Mua.',
        ],
        body: 'Mình sẽ tư vấn dựa trên dữ liệu tin đăng.',
        trailing: ['Chuyên viên sẽ kiểm tra lại giúp bạn.'],
      }),
    ).toBe(
      'Tôi là trợ lý AI của TERAVA.\nTheo tin đăng, căn này đang ghi là còn bán (cập nhật 27/10/2026).\nKhông có khoản đầu tư nào không có rủi ro.\nTiêu chí: Mua.\nMình sẽ tư vấn dựa trên dữ liệu tin đăng.\nChuyên viên sẽ kiểm tra lại giúp bạn.',
    );
  });

  it('inserts one canonical availability notice and removes only model availability sentences', () => {
    const result = normalizeFinalReply(
      'Căn này còn bán. Mình không thể kiểm tra theo thời gian thực. Giá 3,2 tỷ. Bạn muốn hẹn xem không?',
      'Bạn kiểm tra giúp căn này còn bán không?',
      [source(1, { property_id: 'property-1' })],
    );

    expect(result.match(/Theo tin đăng, căn này đang ghi là còn bán/giu)).toHaveLength(1);
    expect(result.match(/27\/10\/2026/g)).toHaveLength(1);
    expect(result).toContain('Giá 3,2 tỷ.');
    expect(result).toContain('Bạn muốn hẹn xem không?');
    expect(result).not.toMatch(/căn này còn bán\.|không thể kiểm tra theo thời gian thực/iu);
  });

  it('leaves a multi-listing availability answer untouched', () => {
    const reply = '- Căn A còn bán [1].\n- Căn B còn trống [2].\n- Căn C đã bán [3].';
    expect(normalizeFinalReply(reply, 'Căn nào còn bán?', [source(1), source(2), source(3)])).toBe(reply);
  });

  it('keeps the deterministic legal fact and at most one separate claim answer', () => {
    const result = normalizeFinalReply(
      'Theo tin đăng, căn số 1 [1] được ghi là đã có sổ hồng; mình không thể xác nhận pháp lý thay cho giấy tờ gốc và cơ quan đăng ký đất đai. Theo dữ liệu tin đăng, căn này được ghi là đã có sổ hồng; mình không thể xác nhận lời hứa của bên thứ ba. Mình không thể xác nhận lời hứa của nhân viên về thời hạn ra sổ.',
      'Căn này có sổ hồng chưa, nhân viên hứa bao giờ ra sổ?',
      [],
    );
    expect(result.match(/được ghi là đã có sổ hồng/giu)).toHaveLength(1);
    expect(result.match(/lời hứa/giu)).toHaveLength(1);
  });

  it('never promises more similar cards than the response sources contain', () => {
    for (const count of [0, 1, 3]) {
      const sources = Array.from({ length: count }, (_, index) => source(index + 1));
      const result = normalizeFinalReply(
        'Mình gửi bên dưới 3 căn tương tự để bạn tham khảo nhé.',
        'Gợi ý căn tương tự.',
        sources,
      );
      if (count === 0) expect(result).not.toContain('căn tương tự');
      else expect(result).toContain('Mình gửi bên dưới ' + count + ' căn tương tự');
    }
  });
});
