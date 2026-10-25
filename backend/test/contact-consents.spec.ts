import { vi, describe, it, expect, beforeEach } from 'vitest';
import { validOrigin } from '../src/common/http.js';

describe('contact consent endpoint validation', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('requires a same-origin browser request', () => {
    expect(validOrigin(new Request('https://api.example/api/account/contact-consents', { headers: { origin: 'https://evil.example' } }) as never)).toBe(false);
    expect(validOrigin(new Request('https://api.example/api/account/contact-consents', { headers: { origin: 'http://localhost:3000' } }) as never)).toBe(true);
  });
  it('keeps the consent purpose allowlist explicit', () => {
    const purposes = ['Call', 'AIVoice', 'Transcript', 'Recording'];
    expect(purposes).toHaveLength(4);
    expect(purposes.includes('Admin')).toBe(false);
  });
});
