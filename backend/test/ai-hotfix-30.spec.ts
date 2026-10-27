import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clarificationFor } from '../src/modules/ai/history-aware.js';
import { outputReason, repairUnsupportedRoomClaims, type Evidence } from '../src/modules/ai/guard.js';
import { deterministicNoMatchReply } from '../src/modules/ai/unsupported.js';

const studio: Evidence = {
  id: 'studio-1',
  code: 'RVL-STUDIO-1',
  name: 'Studio cửa sổ trời',
  price: 5_000_000,
  availability: 'Available',
  updated_at: '2026-10-27T00:00:00.000Z',
  location: 'Quận 10',
  property_type: 'Apartment',
  transaction_type: 'Rent',
  price_period: 'Month',
  bedrooms: null,
  number: 1,
};

describe('Hotfix 30 HARD30 regressions', () => {
  it('keeps the SQL studio bedroom rule in the new additive migration', () => {
    const sql = readFileSync('../supabase/migrations/20261027280000_ai_studio_bedrooms.sql', 'utf8');
    expect(sql).toContain("strpos(pose_private.kb_unaccent(lower(coalesce(p.name,'')||' '||coalesce(c.header,''))),pose_private.kb_unaccent('studio'))>0");
    expect(sql).toContain("strpos(pose_private.kb_unaccent(lower(coalesce(p.name,'')||' '||coalesce(c.header,''))),pose_private.kb_unaccent('1pn'))>0");
    expect(sql).toContain("strpos(pose_private.kb_unaccent(lower(coalesce(p.name,'')||' '||coalesce(c.header,''))),pose_private.kb_unaccent('1 phong ngu'))>0");
    expect(sql).not.toContain('p.bedrooms is null or p.bedrooms=(p_filters->>\'bedrooms\')::integer');
  });

  it('does not attribute a bedroom count to a null-bedroom studio and repairs the sentence', () => {
    const reply = 'Mình gợi ý căn Studio cửa sổ trời có 3 phòng ngủ [1].';
    expect(outputReason(reply, [studio], 'Tôi cần thuê căn hộ có 3 phòng ngủ.')).toBe('UNSUPPORTED_ROOM_COUNT');
    expect(repairUnsupportedRoomClaims(reply, [studio])).toBe('Mình gợi ý căn Studio cửa sổ trời có [1]. Tin đăng chưa ghi số phòng ngủ.');
  });

  it('does not ask for an area when explicitly re-filtering a previous suggestion', () => {
    const history = [
      { role: 'user', content: 'Tôi muốn mua căn hộ ngân sách 3 tỷ' },
      { role: 'assistant', content: 'Mình gợi ý vài căn hộ khoảng 3 tỷ cho bạn tham khảo.' },
    ];
    expect(clarificationFor('Lúc đầu tôi nói ngân sách 3 tỷ, nhưng giờ tôi chỉ có 2 tỷ và không muốn vay ngân hàng nữa. Bạn có thể lọc lại danh sách mà không giới thiệu những căn vượt ngân sách không?', history)).toEqual({ needed: false, question: null, options: [] });
    expect(clarificationFor('Tôi muốn mua căn hộ 3 tỷ', [])).toMatchObject({ needed: true });
  });

  it('builds a deterministic no-match answer without model fallback text', () => {
    const reply = deterministicNoMatchReply({
      criteria: 'Tiêu chí: Mua, ở Quận 1, dưới 2 tỷ, từ 100 m², 3 phòng ngủ.',
      area: 'Quận 1',
      blocker: 'Ở Quận 1, căn hộ dưới 2 tỷ chưa có tin đủ 3 phòng ngủ; căn hộ từ 100 m² thường có giá cao hơn nhiều.',
      related: [{ name: 'Căn hộ gần tiêu chí', location: 'Quận 1', price: 2_500_000_000, reason: 'Lệch tiêu chí: studio, không đủ 3 phòng ngủ', number: 1 }],
      nearby: 'Khu vực thực sự có tin phù hợp với Căn hộ và ngân sách 2 tỷ: Quận 3 (2 căn ≤ 2 tỷ).',
    });
    expect(reply).toContain('Tiêu chí: Mua, ở Quận 1, dưới 2 tỷ, từ 100 m², 3 phòng ngủ.');
    expect(reply).toContain('Hiện chưa có căn nào đáp ứng đủ tất cả tiêu chí của bạn ở Quận 1.');
    expect(reply).toContain('Lệch tiêu chí: studio, không đủ 3 phòng ngủ');
    expect(reply).toContain('Khu vực thực sự có tin phù hợp');
    expect(reply).toContain('chuyên viên');
    expect(reply).not.toContain('chưa đủ dữ liệu để trả lời chắc chắn');
  });
});
