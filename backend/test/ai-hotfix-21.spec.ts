import { describe, expect, it } from 'vitest';
import {
  historyReferenceQuestion,
  outsideCataloguePlace,
  referencedListingCodes,
} from '../src/modules/ai/history-aware.js';

const oneCardHistory = [
  { role: 'user', content: 'thuê căn hộ dưới 8 triệu' },
  {
    role: 'assistant',
    content: 'Một căn hộ ở Bình Thạnh phù hợp [1].',
    sources: [{ id: 'card-1', code: 'HF21-BT-1', price: 5_300_000 }],
  },
];

describe('Hotfix 21 FLOW-3 routing', () => {
  it('treats a named new area as a switch instead of a one-card reference', () => {
    expect(referencedListingCodes('Gò Vấp được không', oneCardHistory)).toMatchObject({ codes: [], ambiguous: false });
    expect(referencedListingCodes('Thôi Quận 9', oneCardHistory)).toMatchObject({ codes: [], ambiguous: false });
    expect(historyReferenceQuestion('Gò Vấp được không', oneCardHistory)).toBe(false);
    expect(referencedListingCodes('Căn này ở Gò Vấp được không', oneCardHistory).codes).toEqual(['HF21-BT-1']);
  });

  it('recognizes cities outside the catalogue before clarification', () => {
    expect(outsideCataloguePlace('Thuê nhà ở Hà Nội dưới 10 triệu')).toBe('Hà Nội');
    expect(outsideCataloguePlace('Tìm căn hộ ở Đà Nẵng')).toBe('Đà Nẵng');
    expect(outsideCataloguePlace('Thuê căn hộ ở Thủ Đức')).toBeNull();
  });
});
