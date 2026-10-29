import { describe, expect, it } from 'vitest';
import { financeNoteForQuestion } from '../src/modules/ai/finance.js';
import {
  availabilityLabel,
  isValidListingPrice,
  outputReason,
  rewriteAvailabilityLabels,
  rewriteUnverifiedAvailability,
  type Evidence,
} from '../src/modules/ai/guard.js';

const listing: Evidence = {
  id: 'title-only',
  code: 'HF20-TITLE',
  name: 'Lô đất giá 1 tỷ 033',
  price: 1_000_000_000,
  availability: 'Available',
  updated_at: '2026-10-27',
  location: 'Quận 9',
  property_type: 'Land',
  transaction_type: 'Sale',
  price_period: 'Total',
  number: 1,
};

describe('Hotfix 20 intent and grounding regressions', () => {
  it('recognizes the two finance advice calculations without inventing a search', () => {
    expect(
      financeNoteForQuestion(
        'Tôi có 800 triệu, thu nhập 20 triệu mỗi tháng, muốn mua căn hộ 3 tỷ. Bạn có dám khuyên tôi vay ngân hàng để mua không?',
      ),
    ).toContain('Khả năng chi trả');
    expect(
      financeNoteForQuestion(
        'Giữa một căn hộ 3 tỷ cho thuê được 10 triệu/tháng và một căn nhà 4 tỷ cho thuê được 15 triệu/tháng, cái nào hiệu quả hơn nếu tính cả chi phí vay?',
      ),
    ).toContain('8–10%/năm');
  });

  it('grounds an amount that appears only in a cited listing title', () => {
    expect(
      outputReason('Lô đất có tiêu đề giá 1 tỷ 033 [1].', [listing], '', {
        sourceText: listing.name,
        listingText: listing.name,
      }),
    ).toBeNull();
  });

  it('rejects impossible rent ceilings above one billion per month', () => {
    expect(isValidListingPrice({ price: 1_000_000_001, transaction_type: 'Rent' })).toBe(false);
    expect(isValidListingPrice({ price: 1_000_000_000, transaction_type: 'Rent' })).toBe(true);
  });

  it('maps enum statuses and removes the awkward availability rewrite', () => {
    expect(availabilityLabel('Available', 'Sale')).toBe('Đang mở bán');
    expect(rewriteAvailabilityLabels('Available [1].', [listing])).toBe('Đang mở bán [1].');
    expect(
      rewriteUnverifiedAvailability(
        'Căn hộ tin đăng đang ghi là còn bán hay không [1].',
        'Bạn có thực sự kiểm tra được căn hộ này còn bán không?',
        [listing],
      ),
    ).not.toContain('căn hộ tin đăng đang ghi là còn bán hay không');
  });
});
