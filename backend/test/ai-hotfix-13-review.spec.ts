import { describe, expect, it } from 'vitest';
import { outputReason, removeReplyArtifacts } from '../src/modules/ai/guard.js';

describe('Hotfix 13 review regressions', () => {
  it('still blocks "đảm bảo" commitments that start with a non-ASCII letter', () => {
    expect(outputReason('Căn này đảm bảo sinh lời 10% mỗi năm.', [], 'có nên đầu tư không')).toBe('UNSUPPORTED_COMMITMENT');
  });

  it('allows a negated guarantee', () => {
    expect(outputReason('Mình không đảm bảo căn nào cũng sinh lời; bạn nên tự kiểm tra thêm.', [], 'có nên đầu tư không')).toBeNull();
  });

  it('keeps descriptive listing lines and strips only bare title–price lines', () => {
    const sources = [{ number: 1, name: 'Căn hộ Long Bình', availability: 'Available' }];
    const reply = 'So sánh giá:\n[1] Căn hộ Long Bình – 2,95 tỷ, rộng 70 m², gần chợ.\n[1] Căn hộ Long Bình – 2,95 tỷ đồng';
    const cleaned = removeReplyArtifacts(reply, sources);
    expect(cleaned).toContain('[1] Căn hộ Long Bình – 2,95 tỷ, rộng 70 m², gần chợ.');
    expect(cleaned.split('\n').at(-1)).toBe('[1] Đang mở bán.');
  });
});
