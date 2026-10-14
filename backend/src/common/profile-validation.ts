export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let phone = value.trim().replace(/[\s().-]/g, '');
  if (!phone) return '';
  if (/^0\d{9}$/.test(phone)) phone = '+84' + phone.slice(1);
  if (/^84\d{9}$/.test(phone)) phone = '+' + phone;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

export function validatePassword(input: Record<string, unknown>) {
  if (Object.keys(input).some(key => !['password', 'confirmPassword'].includes(key))) return 'Dữ liệu đổi mật khẩu không hợp lệ.';
  if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128) return 'Mật khẩu cần từ 12 đến 128 ký tự.';
  if (input.password !== input.confirmPassword) return 'Mật khẩu xác nhận chưa khớp.';
  return null;
}

export function validateProfile(input: Record<string, unknown>) {
  if (Object.keys(input).some(key => !['name', 'phone', 'notificationsEnabled', 'version'].includes(key))) return 'Chỉ được cập nhật thông tin hồ sơ cá nhân.';
  if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 80) return 'Họ tên cần từ 2 đến 80 ký tự.';
  if (normalizePhone(input.phone) === null) return 'Số điện thoại không hợp lệ. Ví dụ: 0912345678 hoặc +84912345678.';
  if (typeof input.notificationsEnabled !== 'boolean') return 'Tùy chọn thông báo không hợp lệ.';
  if (!Number.isSafeInteger(input.version) || Number(input.version) < 0) return 'Phiên bản hồ sơ không hợp lệ. Vui lòng tải lại trang.';
  return null;
}
