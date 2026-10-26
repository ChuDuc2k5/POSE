import { describe, expect, it } from 'vitest';
import { outputReason, groundedSummary, sanitizeReply, labelMonthlyRent } from '../src/modules/ai/guard.js';
import { ownerRequest, unsupportedCriteria, loanWords } from '../src/modules/ai/unsupported.js';
import { inferSearch } from '../src/modules/ai/infer-search.js';
import { adviceOrServiceQuestion, clarificationFor } from '../src/modules/ai/history-aware.js';
import { displayListingName } from '../src/modules/ai/display.js';

const sale = [{ id: 'a', code: 'RVL-1', name: 'Căn hộ Vinhomes Grand Park', location: 'Phường Long Bình', price: 2950000000, area: 61.4, availability: 'Available', updated_at: '', property_type: 'Apartment', transaction_type: 'Sale', price_period: 'Total', number: 1 }] as never;

describe('50 common questions regressions', () => {
  it('buyers and investors are never treated as owners', () => {
    expect(ownerRequest('Mình muốn tìm chung cư 2 phòng ngủ ở Bình Thạnh, ngân sách khoảng 3 tỷ thì có căn nào phù hợp không?')).toBe(false);
    expect(ownerRequest('Giữa mua đất ở Bình Chánh và mua căn hộ ở Thủ Đức thì phương án nào phù hợp hơn nếu mình muốn đầu tư lâu dài?')).toBe(false);
    expect(ownerRequest('Bên bạn có nhà nguyên căn nào cho thuê ở Gò Vấp không?')).toBe(false);
    expect(ownerRequest('Tôi muốn bán nhà ở Quận 7')).toBe(true);
    expect(ownerRequest('Mình muốn cho thuê nhà ở Gò Vấp')).toBe(true);
    expect(ownerRequest('Ký gửi căn hộ của tôi được không?')).toBe(true);
  });

  it('"vậy" is not a loan question', () => {
    expect(loanWords('Diện tích 75m² là thông thủy hay tim tường vậy?')).toBe(false);
    expect(unsupportedCriteria('Hình ảnh là hình thực tế hay minh họa vậy bạn?')).not.toContain('khoản vay ngân hàng');
    expect(unsupportedCriteria('Có 1 tỷ thì vay ngân hàng được không?')).toContain('khoản vay ngân hàng');
    expect(loanWords('Mua trả góp được không?')).toBe(true);
  });

  it('landmarks resolve to a district and skip the area question', () => {
    expect(inferSearch('Có căn hộ nào gần Đại học RMIT đang cho thuê không bạn?')).toMatchObject({ location: 'Quận 7', transaction_type: 'Rent' });
    expect(inferSearch('Có căn hộ studio nào cho thuê gần trung tâm thành phố không?')?.locations).toContain('Quận 1');
    expect(clarificationFor('Có căn hộ nào gần Đại học RMIT đang cho thuê không bạn?', []).needed).toBe(false);
  });

  it('listing names drop the importer "Mã căn:" prefix', () => {
    expect(displayListingName('Mã căn: Lumire tầng 10')).toBe('Lumire tầng 10');
    expect(groundedSummary([{ ...(sale as never[])[0] as object, name: 'Mã căn: BS tầng 16' }] as never)).not.toMatch(/Mã căn|VND/);
  });

  it('FAQ citation tags never reach the customer', () => {
    expect(sanitizeReply('Thông thường cọc 1–3 tháng [FAQ 1][FAQ 2].')).toBe('Thông thường cọc 1–3 tháng.');
  });

  it('allows grounded legal facts and usual-practice advice, still blocks promises', () => {
    const context = { listingText: 'Sẵn sổ hồng, nội thất đầy đủ', sourceText: 'Sẵn sổ hồng', practice: true };
    expect(outputReason('Căn hộ này đã có sổ hồng riêng [1].', sale, '', context)).toBeNull();
    expect(outputReason('Căn hộ này đã có sổ hồng riêng [1].', sale, '', { practice: false })).toBe('UNSUPPORTED_COMMITMENT');
    expect(outputReason('Theo Luật Nhà ở 2023, người nước ngoài được mua căn hộ ở dự án không thuộc khu vực bảo đảm quốc phòng, an ninh, tối đa 30% số căn mỗi tòa [1].', sale, '', context)).toBeNull();
    expect(outputReason('Bạn nên xem trực tiếp để đảm bảo quyền lợi [1].', sale, '', context)).toBeNull();
    expect(outputReason('Mình cam kết căn này sẽ tăng giá [1].', sale, '', context)).toBe('UNSUPPORTED_COMMITMENT');
    expect(outputReason('Bạn hãy đặt cọc ngay hôm nay [1].', sale, '', context)).toBe('UNSUPPORTED_COMMITMENT');
    expect(outputReason('Hiện chưa có căn chung cư nào ở Quận 2 đã có sổ hồng dưới 4 tỷ.', [] as never, 'Có căn chung cư nào ở Quận 2 đã có sổ hồng mà giá dưới 4 tỷ không?', {})).toBeNull();
  });

  it('owners are recognised with "một căn", buyers asking about fees are not owners', () => {
    expect(ownerRequest('Tôi có một căn hộ ở Quận 7, diện tích 82 m², muốn bán thì giá thị trường khoảng bao nhiêu?')).toBe(true);
    expect(ownerRequest('Giá căn hộ này đã bao gồm thuế, phí sang tên và phí môi giới chưa?')).toBe(false);
    expect(unsupportedCriteria('Tôi muốn bán nhà trong vòng 3 tháng.')).toContain('thời gian bán');
    expect(unsupportedCriteria('Khu vực này 3–5 năm tới có tiềm năng tăng giá không?')).toContain('dự báo / tiềm năng tăng giá');
  });

  it('a rent listing near a shopping centre and a rounded price are not flagged', () => {
    const rent = [{ id: 'r', code: 'CFR-1', name: 'BS tầng 16', location: 'Phường Thủ Đức', price: 5500000, availability: 'Available', updated_at: '', property_type: 'Apartment', transaction_type: 'Rent', price_period: 'Month', number: 1 }] as never;
    expect(outputReason('Căn hộ 47 m², gần trường học và trung tâm mua sắm, giá 5,5 triệu/tháng [1].', rent, '', {})).toBeNull();
    const house = [{ id: 'h', code: 'RVL-2', name: 'Nhà hẻm 5m Bình Tân', location: 'Phường Bình Tân', price: 5199900000, availability: 'Available', updated_at: '', property_type: 'House', transaction_type: 'Sale', price_period: 'Total', number: 1 }] as never;
    expect(outputReason('Nhà hẻm 5m ở Bình Tân giá khoảng 5,2 tỷ [1].', house, '', {})).toBeNull();
  });

  it('adds the missing "/tháng" to a listed rent price only', () => {
    const rents = [{ price: 5000000, transaction_type: 'Rent' }, { price: 5500000, transaction_type: 'Rent' }];
    expect(labelMonthlyRent('Studio giá 5 triệu [1]. Căn kia 5,5 triệu/tháng [2]. Căn khác 5 triệu đồng/tháng.', rents)).toBe('Studio giá 5 triệu/tháng [1]. Căn kia 5,5 triệu/tháng [2]. Căn khác 5 triệu đồng/tháng.');
    expect(labelMonthlyRent('Giá đất 125 triệu mỗi m².', rents)).toBe('Giá đất 125 triệu mỗi m².');
  });

  it('room counts the customer asked for and price per m² are grounded', () => {
    expect(outputReason('Hiện chưa có căn chung cư 2 phòng ngủ ở Bình Thạnh khoảng 3 tỷ.', [] as never, 'Mình muốn tìm chung cư 2 phòng ngủ ở Bình Thạnh, ngân sách khoảng 3 tỷ', {})).toBeNull();
    expect(outputReason('Căn này giá 2,95 tỷ, tương đương khoảng 48 triệu mỗi m² [1].', sale, '', {})).toBeNull();
  });
  it('a listing question ending in "được không" is a search, not advice', () => {
    expect(adviceOrServiceQuestion('Có đất nền nào ở khu vực Hóc Môn, đường ô tô vào được không?')).toBe(false);
    expect(adviceOrServiceQuestion('Mình có thể xem nhiều căn hộ trong cùng một buổi được không?')).toBe(true);
  });
});
