import { normalizeEmail, validateCredentials } from '../../frontend/lib/auth-validation.js';

const valid = { email: 'client@example.com', password: 'safe-password-123', confirmPassword: 'safe-password-123', name: 'Khách hàng', acceptTerms: true };
describe('SRS FR-M01-01 registration input', () => {
  it('accepts valid customer signup and normalizes email', () => {
    expect(validateCredentials(valid, true)).toBeNull();
    expect(normalizeEmail('  Client@Example.COM  ')).toBe('client@example.com');
  });
  it('requires twelve characters and matching confirmation', () => {
    expect(validateCredentials({ ...valid, password: 'short' }, true)).not.toBeNull();
    expect(validateCredentials({ ...valid, confirmPassword: 'different-password' }, true)).not.toBeNull();
  });
  it('requires explicit terms acceptance', () => {
    expect(validateCredentials({ ...valid, acceptTerms: false }, true)).not.toBeNull();
  });
  it('rejects internal role assignment and invalid identity fields', () => {
    expect(validateCredentials({ ...valid, role: 'Admin' }, true)).not.toBeNull();
    expect(validateCredentials({ ...valid, app_metadata: { role: 'Sales' } }, true)).not.toBeNull();
    expect(validateCredentials({ ...valid, email: 'invalid' }, true)).not.toBeNull();
    expect(validateCredentials({ ...valid, name: ' ' }, true)).not.toBeNull();
  });
  it('does not prevent existing accounts from signing in using an older password policy', () => {
    expect(validateCredentials({ email: valid.email, password: 'old-secret' })).toBeNull();
  });
});
