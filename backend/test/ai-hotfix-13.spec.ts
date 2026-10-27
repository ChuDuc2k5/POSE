import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { financeEvidenceForQuestion, financeNoteForQuestion } from '../src/modules/ai/finance.js';
import { catalogueOverviewIntent } from '../src/modules/ai/history-aware.js';
import { correctUnknownReply, outputReason, removeReplyArtifacts } from '../src/modules/ai/guard.js';
import { inferSearch } from '../src/modules/ai/infer-search.js';
import { lowestPriced } from '../src/modules/ai/nearest.js';

describe('Hotfix 13 guard grounding and deterministic answer cleanup', () => {
  it('grounds the affordability answer from finance results without listings', () => {
    const question =
      'Tôi có 800 triệu, thu nhập 20 triệu mỗi tháng, muốn mua căn hộ 3 tỷ. Bạn có dám khuyên tôi vay ngân hàng để mua không?';
    const finance = financeEvidenceForQuestion(question);
    expect(finance?.note).toContain('2.200 triệu');
    expect(
      outputReason(finance?.note || '', [], question, {
        retrievalFound: false,
        financeAmounts: finance?.amounts,
        financeRanges: finance?.ranges,
        financePresent: true,
      }),
    ).toBeNull();
  });

  it('grounds the rate-change answer from its computed payments and balance', () => {
    const question =
      'Nếu tôi vay 2 tỷ trong 20 năm, lãi suất tăng từ 8% lên 12% sau hai năm thì mỗi tháng trả thêm bao nhiêu?';
    const finance = financeEvidenceForQuestion(question);
    expect(finance?.note).toContain('4,9 triệu');
    expect(finance?.amounts.length).toBeGreaterThan(3);
    expect(
      outputReason(finance?.note || '', [], question, {
        retrievalFound: false,
        financeAmounts: finance?.amounts,
        financeRanges: finance?.ranges,
        financePresent: true,
      }),
    ).toBeNull();
  });

  it('blocks an extra amount that finance did not compute', () => {
    const question =
      'Nếu tôi vay 2 tỷ trong 20 năm, lãi suất tăng từ 8% lên 12% sau hai năm thì mỗi tháng trả thêm bao nhiêu?';
    const finance = financeEvidenceForQuestion(question);
    expect(
      outputReason(`${finance?.note || ''} Ngoài ra cần thêm 99 triệu đồng.`, [], question, {
        retrievalFound: false,
        financeAmounts: finance?.amounts,
        financeRanges: finance?.ranges,
        financePresent: true,
      }),
    ).toBe('NO_ANSWER_UNGROUNDED');
  });

  it('allows the conditional planning answer when the FAQ is evidence', () => {
    const reply =
      'Có thể chỉ được cấp giấy phép xây dựng có thời hạn hoặc sửa chữa; cần kiểm tra quy hoạch tại địa phương.';
    expect(
      outputReason(reply, [], 'Nếu đất có sổ đỏ nhưng lại nằm trong quy hoạch thì tôi có được xây nhà không?', {
        retrievalFound: true,
        faqEvidence: true,
        practice: true,
      }),
    ).toBeNull();
  });

  it('allows the negated investment-safety answer from the FAQ', () => {
    const reply =
      'Không có khoản đầu tư nào không có rủi ro hoặc được bảo đảm chắc chắn sinh lời; TERAVA không cam kết lợi nhuận.';
    expect(
      outputReason(
        reply,
        [],
        'Tôi muốn mua đất để đầu tư nhưng không muốn chịu bất kỳ rủi ro nào. Bạn có thể giới thiệu một lô đất chắc chắn sinh lời không?',
        { retrievalFound: true, faqEvidence: true, practice: true },
      ),
    ).toBeNull();
  });

  it('continues to block an actual profit commitment', () => {
    expect(
      outputReason('Lô đất này chắc chắn sinh lời và cam kết lợi nhuận 10%.', [], '', {
        retrievalFound: true,
        faqEvidence: true,
        practice: true,
      }),
    ).toBe('UNSUPPORTED_COMMITMENT');
    expect(
      outputReason('Căn này bảo đảm được xây đúng như cam kết.', [], '', {
        retrievalFound: true,
        faqEvidence: true,
        practice: true,
      }),
    ).toBe('UNSUPPORTED_COMMITMENT');
  });

  it('grounds the extra-cost answer with hedged FAQ figures', () => {
    const reply =
      'Thông thường có lệ phí trước bạ 0,5%, thuế TNCN 2% thường do bên bán nộp, phí công chứng và phí bảo trì 2% với căn hộ mới; số tiền cụ thể cần được xác nhận.';
    expect(
      outputReason(
        reply,
        [],
        'Bạn có chắc đây là giá bán cuối cùng không, hay đến lúc ký hợp đồng lại phát sinh thêm chi phí?',
        { retrievalFound: true, faqEvidence: true, practice: true },
      ),
    ).toBeNull();
  });

  it('does not classify the duplicate-listing question as a market overview', () => {
    expect(
      catalogueOverviewIntent(
        'Nếu hai tin đăng có cùng địa chỉ và diện tích nhưng giá khác nhau, bạn có nhận ra đó có thể là cùng một căn nhà không?',
      ),
    ).toBeNull();
  });

  it('does not classify the two-investment comparison as a catalogue overview', () => {
    expect(
      catalogueOverviewIntent(
        'Giữa một căn hộ 3 tỷ cho thuê được 10 triệu/tháng và một căn nhà 4 tỷ cho thuê được 15 triệu/tháng, cái nào đầu tư hiệu quả hơn nếu tính cả chi phí vay?',
      ),
    ).toBeNull();
    expect(
      financeNoteForQuestion(
        'Giữa một căn hộ 3 tỷ cho thuê được 10 triệu/tháng và một căn nhà 4 tỷ cho thuê được 15 triệu/tháng, cái nào đầu tư hiệu quả hơn nếu tính cả chi phí vay?',
      ),
    ).toContain('4%');
  });

  it('removes raw citation-title and market-summary artifacts from detail replies', () => {
    const reply =
      '[1] Bán Căn hộ 2PN – 2,95 tỷ đồng\n[market_summary]\nMình chỉ còn 1 căn khác đúng tiêu chí trong dữ liệu hiện có.';
    const cleaned = removeReplyArtifacts(reply, [{ number: 1, name: 'Bán Căn hộ 2PN' }]);
    expect(cleaned).not.toContain('[market_summary]');
    expect(cleaned).not.toContain('Bán Căn hộ 2PN');
    expect(cleaned).not.toContain('Mình chỉ còn 1 căn khác');
  });

  it('does not append a rental yield to a price-comparison question', () => {
    expect(
      financeNoteForQuestion(
        'Bạn bảo căn này giá tốt, vậy dựa vào đâu để khẳng định nó rẻ hơn những căn khác trong cùng khu vực?',
        2_950_000_000,
        'Theo 5 tin bán cùng loại, giá khoảng 40 triệu đồng/m².',
      ),
    ).toBeNull();
  });

  it('keeps the strict cash ceiling for the re-filter request', () => {
    expect(
      inferSearch(
        'Lúc đầu tôi nói ngân sách 3 tỷ, nhưng giờ tôi chỉ có 2 tỷ và không muốn vay ngân hàng nữa. Bạn có thể lọc lại danh sách không?',
      ),
    ).toMatchObject({ transaction_type: 'Sale', maxPrice: 2_000_000_000, maxPriceExclusive: true });
  });

  it('returns at most three nearest options in price order', () => {
    expect(
      lowestPriced([
        { price: 2_100_000_000 },
        { price: 1_900_000_000 },
        { price: 2_000_000_000 },
        { price: 3_000_000_000 },
      ]),
    ).toEqual([{ price: 1_900_000_000 }, { price: 2_000_000_000 }, { price: 2_100_000_000 }]);
  });

  it('adds planning aliases and question stop-words in a new migration', () => {
    const migration = readFileSync('../supabase/migrations/20261026240000_kb_faq_grounding_hotfix13.sql', 'utf8');
    expect(migration).toContain('dat so do trong quy hoach');
    expect(migration).toContain("'neu','thi','duoc','tren','lai','nam'");
  });

  it('tells the assistant to admit missing listing information plainly', () => {
    const corrected = correctUnknownReply('Mình không tự ý đoán hay nói không biết.');
    expect(corrected).toContain('Tin đăng chưa có thông tin');
    expect(corrected).toContain('chuyên viên');
  });
});
