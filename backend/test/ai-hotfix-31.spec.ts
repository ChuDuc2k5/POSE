import { describe, expect, it } from 'vitest';
import { postgrestIlike } from '../src/common/postgrest.js';
import { centralFormerDistricts, inferSearch } from '../src/modules/ai/infer-search.js';
import { deterministicNoMatchReply } from '../src/modules/ai/unsupported.js';
import { financeNoteForQuestion } from '../src/modules/ai/finance.js';

describe('Hotfix 31 regressions', () => {
  it('quotes reserved characters in area ilike operands', () => {
    const query = [
      postgrestIlike('location', 'Phường Long Bình (Quận 9 cũ)'),
      postgrestIlike('location', 'Quận 9'),
    ].join(',');
    expect(query).toContain('location.ilike."*Phường Long Bình (Quận 9 cũ)*"');
    expect(query).not.toMatch(/location\.ilike\.%[^"\n]*[(),][^"\n]*%/u);
    expect(postgrestIlike('location', 'A\\B "quoted"')).toContain('A\\\\B \\"quoted\\"');
  });

  it('labels a central-district search as khu trung tâm', () => {
    const filters = inferSearch('Tôi cần thuê căn hộ dưới 8 triệu, có 3 phòng ngủ, gần trung tâm') || {};
    expect(filters.locations).toEqual(expect.arrayContaining(centralFormerDistricts));
    const area = filters.locations?.length && filters.locations.every(value => centralFormerDistricts.includes(value))
      ? 'khu trung tâm'
      : filters.location;
    const reply = deterministicNoMatchReply({ area, criteria: 'Tiêu chí: Thuê, gần trung tâm, dưới 8 triệu, 3 phòng ngủ.' });
    expect(reply).toContain('đủ tất cả tiêu chí của bạn ở khu trung tâm.');
    expect(reply).not.toContain('ở Quận 1.');
  });

  it('formats a rate-change balance as tỷ, not grouped millions', () => {
    const note = financeNoteForQuestion('Nếu tôi vay 2 tỷ trong 20 năm, lãi suất tăng từ 8% lên 12% sau hai năm thì mỗi tháng trả thêm bao nhiêu?') || '';
    expect(note).toContain('dư nợ còn khoảng 1,91 tỷ đồng');
    expect(note).not.toMatch(/\d{1,3},\d{3},\d|\d\.\d{3}\.\d/u);
  });
});
