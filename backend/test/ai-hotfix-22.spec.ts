import { describe, expect, it } from 'vitest';
import { moneyAmounts } from '../src/modules/ai/money.js';
import { correctUnknownReply, outputReason, rewriteUnverifiedAvailability, type Evidence } from '../src/modules/ai/guard.js';

const listing: Evidence = {
  id: 'hf22-1', code: 'HF22-1', name: 'Căn hộ', price: 1_850_000_000,
  availability: 'Available', updated_at: '2026-10-27', location: 'Thủ Đức',
  property_type: 'Apartment', transaction_type: 'Sale', price_period: 'Total', number: 1,
};

describe('Hotfix 22 detail regressions', () => {
  it('parses compact billion remainders as millions', () => {
    expect(moneyAmounts('1 tỷ 033')).toEqual([1_033_000_000]);
    expect(moneyAmounts('1 tỷ 333')).toEqual([1_333_000_000]);
  });

  it('replaces unknown-answer sentences as whole sentences and skips known missing-data wording', () => {
    const spliced = 'Tin đăng chưa có thông tin về pháp lý đó. Mình không tự ý đoán hay nói không biết mà sẽ dựa vào quy định chung.';
    expect(correctUnknownReply(spliced)).toBe('Tin đăng chưa có thông tin về pháp lý đó. Tin đăng chưa có thông tin; mình sẽ nhờ chuyên viên tư vấn kiểm tra giúp bạn.');
    expect(correctUnknownReply('Mình không tự ý đoán hay nói không biết.')).toBe('Tin đăng chưa có thông tin; mình sẽ nhờ chuyên viên tư vấn kiểm tra giúp bạn.');
  });

  it('does not repeat the listing phrase while rewriting unverified availability', () => {
    const reply = 'Căn này đang được ghi là còn mở bán trên hệ thống TERAVA, tức là tin đăng đang cập nhật tình trạng tin đăng đang ghi là còn bán [1].';
    const result = rewriteUnverifiedAvailability(reply, 'Bạn có thực sự kiểm tra được căn hộ này còn bán không?', [listing]);
    expect(result).not.toMatch(/tin đăng[^.!?\n]*tin đăng/iu);
    expect(result).toContain('ghi là còn mở bán');
  });

  it('allows a nearby rounded bound but still rejects an invented exact price', () => {
    expect(outputReason('Giá từ khoảng 1,85 tỷ đến dưới 2 tỷ [1].', [listing])).toBeNull();
    expect(outputReason('Căn này có giá 2 tỷ [1].', [listing])).toBe('UNSUPPORTED_PRICE');
  });
});
