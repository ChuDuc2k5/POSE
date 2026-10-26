import { describe, expect, it } from 'vitest';
import { correctUnknownReply, normalizeFinalReply, rewriteUnverifiedAvailability } from '../src/modules/ai/guard.js';

const listing = { availability: 'Available' };

describe('Hotfix 24 legal, availability, and missing-data regressions', () => {
  it('normalizes the assembled reply after every generation path', () => {
    const draft = 'Căn này đang được ghi là còn mở bán trên hệ thống TERAVA, tức là tin đăng đang cập nhật tình trạng tin đăng đang ghi là còn bán [1].';
    const result = normalizeFinalReply(draft, 'Bạn có thực sự kiểm tra được căn hộ này còn bán không?', [listing]);
    expect(result).not.toMatch(/tin đăng[^.!?\n]*tin đăng/iu);
    expect(result).toContain('ghi là còn mở bán');
  });

  it('replaces the whole sentence containing the contradictory unknown-data phrase', () => {
    const result = correctUnknownReply('Tin đăng chưa có thông tin về pháp lý đó. Mình không tự ý đoán hay nói không biết mà sẽ dựa vào quy định chung.');
    expect(result).not.toMatch(/không tự ý đoán hay nói không biết/iu);
    expect(result).toContain('mình sẽ nhờ chuyên viên tư vấn kiểm tra giúp bạn');
  });

  it('keeps the availability rewrite safe when called directly', () => {
    const result = rewriteUnverifiedAvailability(
      'Căn này đang được ghi là còn mở bán trên hệ thống TERAVA, tức là tin đăng đang cập nhật tình trạng tin đăng đang ghi là còn bán [1].',
      'Bạn có thực sự kiểm tra được căn hộ này còn bán không?',
      [listing],
    );
    expect(result).not.toMatch(/tin đăng[^.!?\n]*tin đăng/iu);
  });
});
