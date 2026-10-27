import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT } from '../src/modules/ai/llm.js';
import { financeNoteForQuestion } from '../src/modules/ai/finance.js';
import { dedupeListings, outputReason, removeReplyArtifacts, removeUnpromptedNegotiation, rewriteUnverifiedAvailability } from '../src/modules/ai/guard.js';
import { hcmWards } from '../src/modules/ai/hcm-wards.js';
import { nearestRelaxationStages } from '../src/modules/ai/nearest.js';
import { withFormerDistrict } from '../src/modules/ai/ward-label.js';
import { hasNoMatchReply, noMatchReply } from '../src/modules/ai/unsupported.js';
import { isMoreRequest } from '../src/modules/ai/history-aware.js';

describe('Hotfix 14 HARD30 polish', () => {
  it('allows the exact sentence-level negation while retaining commitment blocks', () => {
    const reply = 'Không có khoản đầu tư bất động sản nào không có rủi ro hoặc được bảo đảm chắc chắn sinh lời. Bạn có thể giảm rủi ro bằng cách kiểm tra kỹ giấy tờ, quy hoạch, thanh khoản và chi phí, nhưng không nên xem đó là cam kết lợi nhuận chắc chắn.';
    expect(outputReason(reply, [], '', { retrievalFound: true, faqEvidence: true, practice: true })).toBeNull();
    expect(outputReason('Lô này chắc chắn sinh lời', [], '', { retrievalFound: true, faqEvidence: true, practice: true })).toBe('UNSUPPORTED_COMMITMENT');
    expect(outputReason('cam kết lợi nhuận 10%', [], '', { retrievalFound: true, faqEvidence: true, practice: true })).toBe('UNSUPPORTED_COMMITMENT');
    expect(outputReason('đảm bảo sinh lời', [], '', { retrievalFound: true, faqEvidence: true, practice: true })).toBe('UNSUPPORTED_COMMITMENT');
    expect(outputReason('Mình không tự ý đoán hay cam kết pháp lý cụ thể.', [], '', { retrievalFound: true, faqEvidence: true, practice: true })).toBeNull();
    expect(outputReason('Mình không đưa ra ý kiến hoặc cam kết pháp lý cụ thể.', [], '', { retrievalFound: true, faqEvidence: true, practice: true })).toBeNull();
  });

  it('deduplicates listings by title, price and area', () => {
    expect(dedupeListings([
      { name: 'Lô đất Hóc Môn', price: 7_200_000_000, area: 256, code: 'A' },
      { name: 'Lô đất Hóc Môn', price: 7_200_000_000, area: 256, code: 'B' },
      { name: 'Lô đất Hóc Môn', price: 7_200_000_000, area: 250, code: 'C' },
    ])).toHaveLength(2);
  });

  it('does not label Hòa Lợi or another external row as Quận 1', () => {
    expect(withFormerDistrict('Phường Hòa Lợi, Thành phố Hồ Chí Minh')).toContain('Thành phố Bến Cát');
    expect(withFormerDistrict('Phường Hòa Lợi, Thành phố Hồ Chí Minh')).not.toContain('Quận 1');
    const districtOneRows = hcmWards.filter(row => row.formerDistricts.includes('Quận 1')).map(row => row.ward);
    expect(districtOneRows).not.toContain('Hòa Lợi');
    expect(districtOneRows).not.toContain('Bắc Tân Uyên');
  });

  it('removes the singular more sentence from non-more replies', () => {
    expect(removeReplyArtifacts('Phần so sánh.\nMình gửi 1 căn khác đúng tiêu chí trong dữ liệu hiện có.', [])).toBe('Phần so sánh.');
    expect(isMoreRequest('Dựa vào đâu để khẳng định căn này rẻ hơn những căn khác trong cùng khu vực?')).toBe(false);
  });

  it('removes unprompted fast-payment discount advice', () => {
    expect(removeUnpromptedNegotiation('Giá có thể phát sinh thêm phí. Nếu bạn thanh toán nhanh hoặc một lần, có thể thương lượng được chiết khấu với chủ nhà.', 'Bạn có chắc đây là giá bán cuối cùng không?')).not.toContain('chiết khấu');
  });

  it('does not add a cash-based no-match budget when a purchase price is stated', () => {
    const question = 'Tôi có 800 triệu, thu nhập 20 triệu mỗi tháng, muốn mua căn hộ 3 tỷ, vay ngân hàng.';
    expect(noMatchReply(question)).toContain('3 tỷ');
    expect(noMatchReply(question)).not.toContain('800 triệu');
  });

  it('recognizes a model no-match sentence before deterministic prefixing', () => {
    expect(hasNoMatchReply('Hiện tại mình chưa tìm được căn hộ nào đáp ứng tất cả trong dữ liệu TERAVA.')).toBe(true);
  });

  it('orders nearest fallback relaxation as price, area, then location', () => {
    const stages = nearestRelaxationStages({ location: 'Quận 1', maxPrice: 2_000_000_000, minArea: 100, bedrooms: 3, type: 'Apartment' });
    expect(stages.map(stage => stage.reason)).toEqual(['Ngoài ngân sách đã nêu', 'Nới diện tích đã nêu', 'Khác khu vực đã nêu', 'Nới ngân sách, diện tích, phòng ngủ và khu vực']);
    expect(stages[0].filters).not.toHaveProperty('maxPrice');
    expect(stages[1].filters).toHaveProperty('maxPrice', 2_000_000_000);
    expect(stages[1].filters).not.toHaveProperty('minArea');
    expect(stages[2].filters).not.toHaveProperty('location');
  });

  it('rewrites available listings as unverified listing status', () => {
    expect(rewriteUnverifiedAvailability('Căn này hiện trạng còn trống [1].', 'Bạn có thực sự kiểm tra được căn này còn trống không?', [{ availability: 'Available' }])).toContain('căn này vẫn được tin đăng ghi là còn bán');
    expect(rewriteUnverifiedAvailability('Tin đăng còn trống [1].', 'Bạn có thực sự kiểm tra được căn này còn trống không?', [{ availability: 'Available' }])).toContain('Tin đăng còn trống');
  });

  it('compares yield with the existing typical loan-rate assumption when loan cost is asked', () => {
    expect(financeNoteForQuestion('Giữa một căn hộ 3 tỷ cho thuê được 10 triệu/tháng và một căn nhà 4 tỷ cho thuê được 15 triệu/tháng, cái nào hiệu quả hơn nếu tính cả chi phí vay?')).toContain('8–10%/năm');
  });

  it('keeps the cost FAQ discoverable and policy advice grounded in the prompt', () => {
    const migration = readFileSync('../supabase/migrations/20261027240000_kb_faq_grounding_hotfix14.sql', 'utf8');
    expect(migration).toContain('gia ban cuoi cung phat sinh them chi phi');
    expect(SYSTEM_PROMPT).toContain('chỉ nói thương lượng khi khách hỏi rõ');
    expect(SYSTEM_PROMPT).toContain('Không nêu chính sách TERAVA ngoài FAQ');
  });
});
