import { describe, expect, it } from 'vitest';
import { derivedFinanceAmounts } from '../src/modules/ai/finance.js';
import { outputDiagnostic, outputReason, rewriteUnverifiedAvailability, rewriteUnsupportedPolicy, sanitizeReply, isValidListingPrice, type Evidence } from '../src/modules/ai/guard.js';

const sale = (price: number, number = 1): Evidence => ({
  id: String(number), code: `RV-TEST-${number}`, name: 'Căn hộ Thủ Đức', price,
  availability: 'Available', updated_at: '2026-10-27', location: 'Thủ Đức',
  property_type: 'Apartment', transaction_type: 'Sale', price_period: 'Total', number,
});
const rent = (price: number, number = 1): Evidence => ({ ...sale(price, number), transaction_type: 'Rent', price_period: 'Month' });

describe('Hotfix 18 price guard, reply formatting and result hygiene', () => {
  it('allows criteria budgets, rounded/current/related prices and previous-turn prices', () => {
    const evidence = [sale(2_990_000_000, 1), sale(2_950_000_000, 2), sale(2_850_000_000, 3)];
    const reply = 'Dưới 3 tỷ, bạn có thể tham khảo một số căn hộ ở Thủ Đức: căn 2,99 tỷ [1], căn 2,95 tỷ [2] và căn 2,85 tỷ [3].';
    expect(outputReason(reply, evidence, 'Căn hộ dưới 3 tỷ ở Thủ Đức', { filterAmounts: [3_000_000_000], previousPrices: [2_589_000_000] })).toBeNull();
    expect(outputReason('Căn này giá 2,589 tỷ [1].', evidence, '', { previousPrices: [2_589_000_000] })).toBeNull();
  });

  it('allows an honest no-data budget and a derived loan amount, but blocks invented prices', () => {
    expect(outputReason('Hiện tại chưa có căn hộ cho thuê ở Quận 9 với giá dưới 10 triệu VND trong dữ liệu.', [], 'Tôi muốn thuê dưới 10 triệu VND', { retrievalFound: false, filterAmounts: [10_000_000] })).toBeNull();
    const listing = sale(2_990_000_000);
    const derived = derivedFinanceAmounts('Nếu vay 70% giá căn này', [listing.price!]);
    expect(derived).toEqual([2_093_000_000]);
    expect(outputReason('Căn số 1 giá 2,99 tỷ [1], nếu vay 70% thì số tiền vay khoảng 2,093 tỷ.', [listing], 'Nếu vay 70% giá căn này', { financeAmounts: derived, financePresent: true })).toBeNull();
    expect(outputReason('Căn số 1 giá 1,5 tỷ [1].', [listing])).toBe('UNSUPPORTED_PRICE');
    expect(outputDiagnostic('Căn số 1 giá 1,5 tỷ [1].', [listing]).detail).toContain('unsupported');
  });

  it('does not treat a plain rental listing answer as a commitment', () => {
    const listing = rent(9_000_000);
    expect(outputReason('Bạn có thể tham khảo một số căn hộ cho thuê dưới 10 triệu đồng tại Thủ Đức [1].', [listing], 'Thuê căn hộ dưới 10 triệu', { filterAmounts: [10_000_000] })).toBeNull();
  });

  it('strips internal bracket tokens while preserving listing citations', () => {
    expect(sanitizeReply('Giá 2,99 tỷ [1]. [FAQ 1, FAQ 2] [tính toán] [market_summary].')).toBe('Giá 2,99 tỷ [1].');
  });

  it('preserves paragraph separators and abbreviations when no policy sentence exists', () => {
    const paragraph = 'Căn hộ ở TP. Hồ Chí Minh có giá 2,5 tỷ. Đây là thông tin tham khảo.';
    expect(rewriteUnsupportedPolicy(paragraph, '', 'Mình chưa có thông tin về chính sách của TERAVA.')).toBe(paragraph);
    expect(rewriteUnsupportedPolicy('TERAVA có chính sách giảm giá riêng. Căn hộ ở TP. Hồ Chí Minh vẫn cần xác nhận.', '', 'Mình chưa có thông tin về chính sách của TERAVA.')).toContain('Mình chưa có thông tin về chính sách của TERAVA. Căn hộ ở TP. Hồ Chí Minh');
  });

  it('removes the duplicate availability wording and rejects junk price rows by transaction type', () => {
    expect(rewriteUnverifiedAvailability('Căn này còn trống, tức là tin đăng đang ghi là còn trống.', 'Bạn kiểm tra căn này còn trống không?', [rent(9_000_000)])).not.toMatch(/còn trống, tức là tin đăng đang ghi là còn trống/iu);
    expect(isValidListingPrice({ price: 100, transaction_type: 'Sale' })).toBe(false);
    expect(isValidListingPrice({ price: 499_999, transaction_type: 'Rent' })).toBe(false);
    expect(isValidListingPrice({ price: 500_000, transaction_type: 'Rent' })).toBe(true);
    expect(isValidListingPrice({ price: 50_000_000, transaction_type: 'Sale' })).toBe(true);
  });
});
