import { describe, expect, it } from 'vitest';
import { explicitWriteIntent, outputReason, sanitizeReply, sourcesFromCitations } from '../src/modules/ai/guard.js';
import { inferTransactionType } from '../src/modules/ai/infer-search.js';
import { referencedListingCodes } from '../src/modules/ai/history-aware.js';

const property = (number: number, code = `CFR-${number}ABC`) => ({ id: String(number), code, name: `Căn hộ ${number}`, price: 3000000000, availability: 'Available', updated_at: '2026-01-01', location: 'Quận 1', property_type: 'Apartment', number });

describe('M06 change 1', () => {
  it('resolves direct codes and back-references but ignores a new search', () => {
    expect(referencedListingCodes('Chi tiết CFR-0FC7C10BB520419B', [])).toEqual({ codes: ['CFR-0FC7C10BB520419B'], ambiguous: false });
    const history = [{ role: 'assistant', content: 'Mã: CFR-ONE1234, CFR-TWO1234' }];
    expect(referencedListingCodes('Giá căn này thế nào?', history)).toEqual({ codes: ['CFR-ONE1234', 'CFR-TWO1234'], ambiguous: true });
    expect(referencedListingCodes('Tìm căn hộ Quận 2 dưới 5 tỷ', history)).toEqual({ codes: [], ambiguous: false });
  });

  it('uses word edges for transaction inference', () => {
    expect(inferTransactionType('bên bạn có căn nào')).toBeUndefined();
    expect(inferTransactionType('ban công')).toBeUndefined();
    expect(inferTransactionType('ngân sách 3 tỷ')).toBe('Sale');
    expect(inferTransactionType('thuê 10-15 triệu')).toBe('Rent');
  });

  it('requires an explicit write request and sanitizes model leakage', () => {
    expect(explicitWriteIntent('lưu ý giúp tôi')).toBe(false);
    expect(explicitWriteIntent('lưu căn này')).toBe(true);
    expect(explicitWriteIntent('nhờ nhân viên tư vấn liên hệ')).toBe(true);
    expect(sanitizeReply('DATA [n]')).toBe('dữ liệu');
  });

  it('returns only cited sources, or the referenced listing regardless of citation', () => {
    const sources = [property(1), property(2), property(3)];
    expect(sourcesFromCitations('Xem [2] rồi [1].', sources)).toEqual([sources[1], sources[0]]);
    expect(sourcesFromCitations('Thông tin căn này.', [sources[0]], true)).toEqual([sources[0]]);
    expect(sourcesFromCitations('Không có trích dẫn.', sources)).toEqual([]);
  });

  it('accepts catalogue-only referenced-listing answers with honest missing-data wording', () => {
    const source = [property(1, 'CFR-0FC7C10BB520419B')];
    expect(outputReason('Căn này ở Quận 1. Thời gian di chuyển chưa có thông tin; bạn có thể trao đổi với chuyên viên tư vấn.', source, 'Từ căn hộ này đi đến trung tâm Quận 1 mất bao lâu?')).toBeNull();
    expect(outputReason('Giá căn này chưa có dữ liệu. Chuyên viên tư vấn có thể hỗ trợ thêm.', source, 'Căn này giá bao nhiêu?')).toBeNull();
  });
});
