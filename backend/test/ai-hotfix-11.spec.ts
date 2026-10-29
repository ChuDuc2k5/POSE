import { describe, expect, it } from 'vitest';
import {
  annuityPayment,
  financeNoteForQuestion,
  grossRentalYield,
  rateChangePayment,
  remainingBalance,
  safeMonthlyPayment,
} from '../src/modules/ai/finance.js';
import { answerCriteriaLine, showCriteriaLine } from '../src/modules/ai/answer-rules.js';
import {
  adviceOrServiceQuestion,
  clarificationFor,
  historyReferenceQuestion,
  searchCriteriaFromHistory,
} from '../src/modules/ai/history-aware.js';
import { genericHome, inferSearch } from '../src/modules/ai/infer-search.js';
import { loanBudget, loanWords, noLoanWords, dedupeNoMatchReply } from '../src/modules/ai/unsupported.js';
import { RetrievalService } from '../src/modules/ai/retrieval.js';

describe('Hotfix 11 deterministic routing and parsing', () => {
  it('routes a conditional hypothetical to advice without clarification', () => {
    expect(adviceOrServiceQuestion('Nếu giá đất tăng liên tục thì bạn sẽ trả lời thế nào?')).toBe(true);
    expect(clarificationFor('Nếu giá đất tăng liên tục thì bạn sẽ trả lời thế nào?', [])).toMatchObject({
      needed: false,
    });
  });

  it('routes a certainty question to advice without clarification', () => {
    expect(adviceOrServiceQuestion('Có chắc 5 năm tới giá đất vẫn tăng không?')).toBe(true);
    expect(clarificationFor('Có chắc 5 năm tới giá đất vẫn tăng không?', [])).toMatchObject({ needed: false });
  });

  it('routes a challenge about unknown legal data to advice without clarification', () => {
    expect(adviceOrServiceQuestion('Bạn có dám nói là không biết không?')).toBe(true);
    expect(clarificationFor('Bạn có dám nói là không biết không?', [])).toMatchObject({ needed: false });
  });

  it('routes opinion and evidence questions to advice without clarification', () => {
    expect(adviceOrServiceQuestion('Dựa vào đâu để tôi nên tin thông tin này?')).toBe(true);
    expect(adviceOrServiceQuestion('Có phải giá này là tốt không?')).toBe(true);
  });

  it('routes cost and rate calculations to advice without clarification', () => {
    expect(adviceOrServiceQuestion('Tính cả chi phí vay thì phương án nào hiệu quả hơn?')).toBe(true);
    expect(adviceOrServiceQuestion('Khoản vay này bao nhiêu tiền mỗi tháng?')).toBe(true);
  });

  it('routes a listing history reference to advice without clarification', () => {
    const history = [{ role: 'assistant', content: 'Mình vừa giới thiệu ba căn hộ: [1], [2], [3].' }];
    expect(historyReferenceQuestion('Trong ba căn hộ bạn vừa giới thiệu, căn nào rẻ nhất?', history)).toBe(true);
    expect(clarificationFor('Trong ba căn hộ bạn vừa giới thiệu, căn nào rẻ nhất?', history)).toMatchObject({
      needed: false,
    });
  });

  it('keeps a genuine buy search eligible for clarification', () => {
    expect(adviceOrServiceQuestion('Tôi muốn mua nhà')).toBe(false);
    expect(clarificationFor('Tôi muốn mua nhà', [])).toMatchObject({ needed: true });
  });

  it('keeps a genuine suggestion-to-buy search eligible for clarification', () => {
    expect(adviceOrServiceQuestion('Gợi ý mua nhà')).toBe(false);
    expect(clarificationFor('Gợi ý mua nhà', [])).toMatchObject({ needed: true });
  });

  it('treats generic home wording as an untyped place to live', () => {
    for (const phrase of ['thuê nhà', 'mua nhà', 'tìm nhà', 'nhà ở', 'chỗ ở', 'nhà để ở', 'gợi ý mua nhà']) {
      expect(genericHome(phrase), phrase).toBe(true);
      expect(inferSearch(phrase) || {}, phrase).not.toHaveProperty('type');
      expect(inferSearch(phrase) || {}, phrase).toMatchObject({ types: ['House', 'Apartment'] });
    }
  });

  it('keeps explicit house wording typed as House', () => {
    expect(genericHome('thuê nhà phố Quận 9')).toBe(false);
    expect(inferSearch('thuê nhà phố Quận 9')).toMatchObject({
      type: 'House',
      transaction_type: 'Rent',
      location: 'Quận 9',
    });
  });

  it('remembers generic home criteria without adding House', () => {
    const history = [
      { role: 'user', content: 'Tôi muốn thuê nhà' },
      { role: 'assistant', content: 'Bạn đang tìm nhà thuê ở khu vực nào và ngân sách khoảng bao nhiêu mỗi tháng ạ?' },
      { role: 'user', content: 'Dưới 10 triệu' },
      { role: 'assistant', content: 'Bạn muốn xem khu vực nào?' },
      { role: 'user', content: 'Ở Quận 9' },
      { role: 'assistant', content: 'Tiêu chí: Thuê, ở Quận 9, dưới 10 triệu đồng/tháng.' },
    ];
    expect(searchCriteriaFromHistory('Ở Quận 9', history)).toMatchObject({
      transaction_type: 'Rent',
      location: 'Quận 9',
      maxPrice: 10_000_000,
      maxPriceExclusive: true,
    });
    expect(searchCriteriaFromHistory('Ở Quận 9', history)).not.toHaveProperty('type');
    expect(searchCriteriaFromHistory('Ở Quận 9', history)).toMatchObject({ types: ['House', 'Apartment'] });
    expect(searchCriteriaFromHistory('Có căn nào khác không', history)).toMatchObject({
      transaction_type: 'Rent',
      location: 'Quận 9',
      maxPrice: 10_000_000,
      maxPriceExclusive: true,
    });
    expect(searchCriteriaFromHistory('Có căn nào khác không', history)).not.toHaveProperty('type');
    expect(searchCriteriaFromHistory('Có căn nào khác không', history)).toMatchObject({
      types: ['House', 'Apartment'],
    });
  });

  it('treats negated borrowing as no loan', () => {
    expect(loanWords('Tôi không muốn vay ngân hàng nữa')).toBe(false);
    expect(noLoanWords('Tôi không muốn vay ngân hàng nữa')).toBe(true);
    expect(loanBudget('Tôi có 2 tỷ và không muốn vay ngân hàng nữa')).toBeNull();
  });

  it('treats the short no-loan wording as no loan', () => {
    expect(loanWords('Tôi không vay')).toBe(false);
    expect(noLoanWords('Tôi không vay')).toBe(true);
  });

  it('treats the no-need-to-borrow wording as no loan', () => {
    expect(loanWords('Tôi không cần vay')).toBe(false);
    expect(noLoanWords('Tôi không cần vay')).toBe(true);
  });

  it('uses cash as a strict ceiling when borrowing is rejected', () => {
    expect(inferSearch('Tôi có 2 tỷ và không muốn vay ngân hàng nữa')).toMatchObject({
      maxPrice: 2_000_000_000,
      maxPriceExclusive: true,
      transaction_type: 'Sale',
    });
  });

  it('does not treat a stated loan amount as cash', () => {
    expect(loanWords('Tôi vay 2 tỷ trong 20 năm')).toBe(true);
    expect(inferSearch('Tôi vay 2 tỷ trong 20 năm')).not.toHaveProperty('maxPrice');
  });

  it('keeps cash and purchase price in their separate roles', () => {
    expect(inferSearch('Tôi có 800 triệu, thu nhập 20 triệu mỗi tháng, mua căn hộ 3 tỷ')).toMatchObject({
      maxPrice: 3_000_000_000,
      transaction_type: 'Sale',
    });
    expect(loanBudget('Tôi có 800 triệu, thu nhập 20 triệu mỗi tháng, mua căn hộ 3 tỷ và vay ngân hàng')).toBeNull();
  });

  it('derives a total budget only for cash plus an active extra loan', () => {
    expect(loanBudget('Tôi có 2 tỷ, vay thêm thì mua được căn nào?')).toBe(5_000_000_000);
    expect(inferSearch('Tôi có 2 tỷ, vay thêm thì mua được căn nào?')).toMatchObject({ maxPrice: 5_000_000_000 });
  });

  it('shows criteria only for a listing search with cards and non-transaction criteria', () => {
    expect(
      showCriteriaLine({
        searchPerformed: true,
        propertyId: null,
        adviceOnly: false,
        cards: 2,
        criteria: ['ở Quận 7'],
        transactionOnly: false,
      }),
    ).toBe(true);
    expect(answerCriteriaLine(['mua', 'ở Quận 7'])).toContain('Tiêu chí: mua, ở Quận 7.');
  });

  it('hides criteria on a detail-page answer', () => {
    expect(
      showCriteriaLine({
        searchPerformed: true,
        propertyId: 'property-1',
        adviceOnly: false,
        cards: 1,
        criteria: ['ở Quận 7'],
        transactionOnly: false,
      }),
    ).toBe(false);
  });

  it('hides criteria on advice and legal answers', () => {
    expect(
      showCriteriaLine({
        searchPerformed: false,
        propertyId: null,
        adviceOnly: true,
        cards: 0,
        criteria: ['ở Quận 7'],
        transactionOnly: false,
      }),
    ).toBe(false);
  });

  it('hides criteria when only transaction type is known', () => {
    expect(
      showCriteriaLine({
        searchPerformed: true,
        propertyId: null,
        adviceOnly: false,
        cards: 1,
        criteria: [],
        transactionOnly: true,
      }),
    ).toBe(false);
  });

  it('calculates an annuity payment and total interest', () => {
    const result = annuityPayment(2_000_000_000, 8, 20);
    expect(result.monthlyPayment).toBeCloseTo(16_728_801.38, 2);
    expect(result.totalInterest).toBeCloseTo(2_014_912_331.17, 2);
  });

  it('calculates the remaining balance after two years', () => {
    expect(remainingBalance(2_000_000_000, 8, 20, 24)).toBeCloseTo(1_911_944_682.82, 2);
  });

  it('calculates the rate-change payment and difference', () => {
    const result = rateChangePayment(2_000_000_000, 8, 12, 20, 2);
    expect(result.newMonthlyPayment).toBeCloseTo(21_642_265.15, 2);
    expect(result.paymentDifference).toBeCloseTo(4_913_463.77, 2);
  });

  it('handles a zero-interest annuity', () => {
    expect(annuityPayment(120_000_000, 0, 10).monthlyPayment).toBe(1_000_000);
  });

  it('calculates gross rental yield', () => {
    expect(grossRentalYield(10_000_000, 3_000_000_000)).toBeCloseTo(0.04, 10);
    expect(grossRentalYield(15_000_000, 4_000_000_000)).toBeCloseTo(0.045, 10);
  });

  it('calculates the common 40 percent payment reference', () => {
    expect(safeMonthlyPayment(20_000_000)).toBe(8_000_000);
  });

  it('builds the rate-change answer from the customer numbers', () => {
    const note = financeNoteForQuestion(
      'Nếu tôi vay 2 tỷ trong 20 năm, lãi suất tăng từ 8% lên 12% sau hai năm thì mỗi tháng trả thêm bao nhiêu?',
    );
    expect(note).toContain('16,7 triệu');
    expect(note).toContain('21,6 triệu');
    expect(note).toContain('4,9 triệu');
    expect(note).toContain('dư nợ giảm dần');
  });

  it('builds the affordability answer from cash, income and purchase price', () => {
    const note = financeNoteForQuestion('Tôi có 800 triệu, thu nhập 20 triệu mỗi tháng, muốn mua căn hộ 3 tỷ.');
    expect(note).toContain('vay khoảng 2.200 triệu');
    expect(note).toContain('40%');
    expect(note).toContain('không an toàn');
  });

  it('compares gross yields with the two explicit alternatives', () => {
    const note = financeNoteForQuestion(
      'Một căn hộ 3 tỷ cho thuê được 10 triệu/tháng và một căn nhà 4 tỷ cho thuê được 15 triệu/tháng.',
    );
    expect(note).toContain('4%');
    expect(note).toContain('4,5%');
  });

  it('calculates yield from the listing price and area rent median', () => {
    const note = financeNoteForQuestion(
      'Căn hộ này cho thuê có lợi nhuận tốt không?',
      2_950_000_000,
      'Theo 5 tin: giá thuê từ 6 triệu đồng/tháng đến 9 triệu đồng/tháng, phổ biến khoảng 7,5 triệu đồng/tháng.',
    );
    expect(note).toContain('3,1%');
  });

  it('deduplicates no-match paragraphs', () => {
    const reply =
      'Hiện chưa có căn phù hợp trong dữ liệu.\n\nHiện chưa tìm thấy căn nào phù hợp.\n\nBạn có thể nới khu vực.';
    expect(dedupeNoMatchReply(reply).match(/chưa (?:có|tìm thấy)/giu)).toHaveLength(1);
  });

  it('keeps FAQ fixture rows in the knowledge result', async () => {
    const service = new RetrievalService(
      { embed: async () => ({ model: 'fixture', vectors: [[1]] }) } as never,
      async () => ({
        data: [
          {
            chunk_id: 'faq-1',
            document_id: 'doc-1',
            source_id: null,
            source_type: 'Faq',
            header: 'Đất nằm trong quy hoạch thì được xây gì?',
            content: 'Tùy kế hoạch sử dụng đất hằng năm; hãy kiểm tra tại cơ quan địa phương.',
            vector_rank: null,
            text_rank: 1,
            similarity: 0.9,
          },
        ],
        error: undefined,
      }),
    );
    const rows = await service.searchRowsWithEmbedding(
      'đất trong quy hoạch',
      {},
      {},
      { model: 'fixture', vector: '[1]' },
    );
    expect(rows[0]).toMatchObject({ source_type: 'Faq', header: 'Đất nằm trong quy hoạch thì được xây gì?' });
  });
});
