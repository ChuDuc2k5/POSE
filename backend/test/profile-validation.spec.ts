import { normalizePhone, validatePassword, validateProfile } from '../../frontend/lib/profile-validation.js';

describe('M01 profile and recovery validation', () => {
  const profile = { name: 'Khách hàng', phone: '0912345678', notificationsEnabled: true, version: 0 };
  it('normalizes Vietnamese numbers and accepts E164 international numbers', () => {
    expect(normalizePhone('0912 345 678')).toBe('+84912345678');
    expect(normalizePhone('84912345678')).toBe('+84912345678');
    expect(normalizePhone('+1 (415) 555-1234')).toBe('+14155551234');
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('hello')).toBeNull();
  });
  it('accepts only editable fields and a valid profile version', () => {
    expect(validateProfile(profile)).toBeNull();
    for (const field of ['role','user_id','email','account_status','phoneVerified','avatarPath']) {
      expect(validateProfile({ ...profile, [field]: 'forged' })).not.toBeNull();
    }
    expect(validateProfile({ ...profile, version: -1 })).not.toBeNull();
    expect(validateProfile({ ...profile, notificationsEnabled: 'true' })).not.toBeNull();
  });
  it('enforces password policy and confirmation before consuming a recovery link', () => {
    expect(validatePassword({ password: 'new-safe-password-123', confirmPassword: 'new-safe-password-123' })).toBeNull();
    expect(validatePassword({ password: 'short', confirmPassword: 'short' })).not.toBeNull();
    expect(validatePassword({ password: 'new-safe-password-123', confirmPassword: 'mismatch' })).not.toBeNull();
    expect(validatePassword({ password: 'a'.repeat(129), confirmPassword: 'a'.repeat(129) })).not.toBeNull();
  });
});
