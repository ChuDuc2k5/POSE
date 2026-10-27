import { describe, expect, it } from 'vitest';
import { normalizeFinalReply, outputReason, type Evidence } from '../src/modules/ai/guard.js';

const listing: Evidence = {
  id: 'property-1',
  code: 'RVL-1',
  name: 'Căn hộ Studio cửa sổ trời',
  price: 1_920_000_000,
  availability: 'Available',
  updated_at: '2026-10-25T00:00:00.000Z',
  location: 'Thủ Đức',
  property_type: 'Apartment',
  bedrooms: null,
  number: 1,
};

describe('Hotfix 28 HARD30 regressions', () => {
  it('counts similar cards from related, not the viewed listing', () => {
    const reply = normalizeFinalReply(
      'Mình gửi bên dưới 3 căn tương tự để bạn tham khảo nhé.',
      'Gợi ý căn tương tự.',
      [listing],
      { relatedCount: 3 } as never,
    );
    expect(reply).toContain('3 căn tương tự');
  });

  it('does not attribute a customer bedroom criterion to a cited studio', () => {
    expect(outputReason(
      'Mình gợi ý căn Studio cửa sổ trời có 3 phòng ngủ [1].',
      [listing],
      'Mình cần căn hộ có 3 phòng ngủ.',
    )).toBe('UNSUPPORTED_ROOM_COUNT');
  });

  it('rejects unmatched area and bedroom claims for nearby-area counts', () => {
    expect(outputReason(
      'Thủ Đức có căn hộ diện tích trên 100 m², 3 phòng ngủ, giá dưới 2 tỷ.',
      [],
      '',
      { nearbyAreaCriteria: { areas: ['Thủ Đức'], matched: ['type', 'budget'], unmatched: ['area', 'bedrooms'] } } as never,
    )).toBe('UNSUPPORTED_NEARBY_CRITERIA');
  });

  it('uses the plain missing-data sentence for hedged unknown replies', () => {
    const reply = normalizeFinalReply(
      'Mình không nói là không biết mà sẽ cung cấp thông tin chung.',
      'Bạn có dám nói là không biết không?',
      [],
      { includeAvailabilityNotice: false },
    );
    expect(reply).toBe('Nếu dữ liệu không có, mình sẽ nói thẳng là mình chưa biết và nhờ chuyên viên kiểm tra giúp bạn.');
  });

  it('dedupes the legal fact after trailing notes and keeps the advice', () => {
    const reply = normalizeFinalReply(
      'Theo tin đăng, căn số 1 [1] được ghi là đã có sổ hồng (sẵn sổ). Mình không thể xác nhận pháp lý thay cho giấy tờ gốc; bạn nên kiểm tra bản gốc và cơ quan đăng ký đất đai. Theo dữ liệu tin đăng, căn này được ghi là đã có sổ hồng; mình không thể xác nhận lời hứa của nhân viên về thời hạn ra sổ. Bạn nên xem bản gốc giấy chứng nhận.',
      'Nhân viên nói chưa có sổ hồng, bao giờ ra sổ?',
      [],
      { includeAvailabilityNotice: false },
    );
    expect(reply.match(/được ghi là đã có sổ hồng/giu)).toHaveLength(1);
    expect(reply.match(/bản gốc/giu)).toHaveLength(1);
  });

  it('formats ISO dates in final replies as dd/mm/yyyy', () => {
    const reply = normalizeFinalReply(
      'Dữ liệu tin đăng này cập nhật ngày 2026-10-25.',
      'Tin này cập nhật lần cuối khi nào?',
      [],
      { includeAvailabilityNotice: false },
    );
    expect(reply).toBe('Dữ liệu tin đăng này cập nhật ngày 25/10/2026.');
  });
});
