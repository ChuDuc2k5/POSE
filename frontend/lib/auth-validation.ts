export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function validateCredentials(input: Record<string, unknown>, signup = false): string | null {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return 'Vui lòng nhập địa chỉ email hợp lệ.';
  if (typeof input.password !== 'string' || !input.password || input.password.length > 128) return 'Vui lòng nhập mật khẩu hợp lệ (tối đa 128 ký tự).';
  if (!signup) return null;
  if (input.password.length < 12) return 'Mật khẩu cần ít nhất 12 ký tự.';
  if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 80) return 'Tên hiển thị cần từ 2 đến 80 ký tự.';
  if (input.password !== input.confirmPassword) return 'Mật khẩu xác nhận chưa khớp.';
  if (input.acceptTerms !== true) return 'Bạn cần chấp thuận điều khoản để tạo tài khoản.';
  if ('role' in input || 'app_metadata' in input) return 'Đăng ký công khai chỉ dành cho tài khoản khách hàng.';
  return null;
}
