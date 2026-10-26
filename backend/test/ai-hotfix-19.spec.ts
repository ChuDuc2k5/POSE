import { describe, expect, it } from 'vitest';
import { clarificationFor, budgetFollowUp, isAreaOnlyRefinement, isMoreRequest, searchCriteriaFromHistory } from '../src/modules/ai/history-aware.js';
import { shortListingName } from '../src/modules/ai/display.js';

const cp=(...codes: number[])=>String.fromCodePoint(...codes);
const rentBudget=`thu${cp(0xea)} c${cp(0x103)}n h${cp(0x1ed9)} d${cp(0x1b0)}${cp(0x1edb)}i 8 tri${cp(0x1ec7)}u`;
const criteriaHistory=[{role:'user',content:rentBudget},{role:'assistant',content:'Tiêu chí: Thuê, Căn hộ, dưới 8 triệu đồng'}];

describe('Hotfix 19 flow memory', () => {
  it('stages an owner clarification for a budgeted rental without an area', () => {
    const result=clarificationFor(rentBudget, []);
    expect(result.needed).toBe(true);
    expect(result.options).toContain('Quận 7');
    expect(result.options).toContain('Bình Thạnh');
  });

  it('keeps the explicit broad-search exceptions', () => {
    expect(clarificationFor('căn hộ rẻ nhất', []).needed).toBe(false);
    expect(clarificationFor('gợi ý giúp tôi', []).needed).toBe(false);
    expect(clarificationFor('căn hộ dưới 8 triệu ở đâu cũng được', []).needed).toBe(false);
  });

  it('recognizes area-only switch wording and replaces only location', () => {
    for (const message of ['q7 được không','thôi Bình Thạnh','Thủ Đức thì sao','còn Gò Vấp','đổi sang Quận 9','chuyển qua q7','Bình Thạnh nhé']) {
      expect(isAreaOnlyRefinement(message, criteriaHistory), message).toBe(true);
      const active=searchCriteriaFromHistory(message, criteriaHistory);
      expect(active.transaction_type).toBe('Rent');
      expect(active.type).toBe('Apartment');
      expect(active.maxPrice).toBe(8000000);
      expect(active.location || active.locations).toBeTruthy();
    }
  });

  it('keeps the remembered ceiling for the stronger cheaper request', () => {
    const result=budgetFollowUp('rẻ hơn nữa', [
      {role:'user',content:'mua căn hộ Thủ Đức dưới 3 tỷ'},
      {role:'assistant',content:'Tiêu chí: Mua, Căn hộ, ở Thủ Đức, dưới 3 tỷ đồng',sources:[{price:2850000000},{price:2500000000}]},
    ]);
    expect(result?.direction).toBe('cheaper');
    expect(result?.filters.maxPrice).toBe(3000000000);
  });

  it('recognizes every paging phrase used by the flow', () => {
    expect(isMoreRequest('còn căn nào khác không')).toBe(true);
    expect(isMoreRequest('còn nữa không')).toBe(true);
    expect(isMoreRequest('có căn nào khác không')).toBe(true);
  });

  it('removes field-heavy importer titles from customer-facing names', () => {
    const title='BS tầng 22 Loại căn: 2pn+ 2wc 69m Loại hđ: 1 năm Nội thất: bếp rèm Giá thuê: 7tr';
    const shown=shortListingName(title);
    expect(shown).not.toMatch(/Loại căn|Giá thuê/iu);
    expect(shown.length).toBeLessThan(title.length);
  });
});
