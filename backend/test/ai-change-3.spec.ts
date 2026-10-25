import { describe, expect, it } from 'vitest';
import { inferSearch } from '../src/modules/ai/infer-search.js';
import { noMatchReply, unsupportedCriteria } from '../src/modules/ai/unsupported.js';

describe('M06 change 3 review fixes', () => {
  it('does not read "ngân hàng" as a short-term lease', () => {
    expect(unsupportedCriteria('Anh có khoảng 2 tỷ tiền mặt, nếu vay thêm ngân hàng thì mua được những căn nào?')).toEqual(['khoản vay ngân hàng']);
    expect(unsupportedCriteria('Tôi muốn thuê nhà trong 6 tháng, có hỗ trợ hợp đồng ngắn hạn không?')).toEqual(['hợp đồng ngắn hạn']);
  });
  it('treats the amount next to a loan as cash in hand', () => {
    expect(inferSearch('Anh có khoảng 2 tỷ tiền mặt, nếu vay thêm ngân hàng thì mua được những căn nào?')?.maxPrice).toBe(5000000000);
    expect(inferSearch('Nếu tôi có sẵn 2 tỷ và muốn vay ngân hàng thì có thể mua căn nào?')?.maxPrice).toBe(5000000000);
  });
  it('writes the no-match reply with accents and the customer criteria', () => {
    expect(noMatchReply('Tôi muốn mua căn hộ ở Quận 7, ngân sách khoảng 3 tỷ.')).toContain('ở Quận 7 trong khoảng 3 tỷ');
    expect(noMatchReply('Với ngân sách 2 tỷ, tôi có thể mua những bất động sản nào ở Tân Phú?')).toContain('ở Tân Phú trong khoảng 2 tỷ');
  });
});
