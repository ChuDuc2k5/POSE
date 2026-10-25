import { normalizeEmail } from './auth-validation.js';
import { normalizePhone } from './profile-validation.js';
import { uuidPattern } from './catalog.js';

export function salesListInput(params: URLSearchParams) {
  const allowed = ['q', 'status', 'page', 'pageSize'];
  const query = (params.get('q') || '').trim(), status = params.get('status') || 'all';
  const page = Number(params.get('page') ?? 1), size = Number(params.get('pageSize') ?? 20);
  const invalid = [...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)
    || query.length > 120 || !['all', 'active', 'suspended'].includes(status)
    || !Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isSafeInteger(size) || size < 1 || size > 50;
  return { query, status, page, size, invalid };
}

export function salesInput(input: Record<string, unknown>, kind: 'create' | 'update' | 'status') {
  const allowed = kind === 'create' ? ['request_key', 'email', 'name', 'phone', 'password', 'confirmPassword']
    : kind === 'update' ? ['name', 'phone', 'version', 'profile_version', 'reason'] : ['status', 'version', 'reason'];
  const fields: Record<string, string> = {};
  if (Object.keys(input).some(key => !allowed.includes(key))) fields.form = 'Yêu cầu chứa trường không được phép.';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const phone = normalizePhone(input.phone), email = normalizeEmail(input.email);
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (kind !== 'status') {
    if (name.length < 2 || name.length > 80 || Array.from(name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) fields.name = 'Họ tên từ 2 đến 80 ký tự.';
    if (phone === null) fields.phone = 'Nhập số điện thoại hợp lệ hoặc để trống.';
  }
  if (kind === 'create') {
    if (typeof input.request_key !== 'string' || !uuidPattern.test(input.request_key)) fields.form = 'Mã yêu cầu tạo tài khoản không hợp lệ.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fields.email = 'Nhập email hợp lệ.';
    if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128) fields.password = 'Mật khẩu từ 12 đến 128 ký tự.';
    if (input.password !== input.confirmPassword) fields.confirmPassword = 'Mật khẩu xác nhận chưa khớp.';
  } else {
    if (!Number.isSafeInteger(input.version) || Number(input.version) < 0) fields.form = 'Phiên bản không hợp lệ. Tải lại dữ liệu.';
    if (reason.length < 3 || reason.length > 1000 || reason.includes('\0')) fields.reason = 'Nhập lý do từ 3 đến 1.000 ký tự.';
    if (kind === 'update' && (!Number.isSafeInteger(input.profile_version) || Number(input.profile_version) < 0)) fields.form = 'Phiên bản hồ sơ không hợp lệ. Tải lại dữ liệu.';
    if (kind === 'status' && !['active', 'suspended'].includes(input.status as string)) fields.status = 'Trạng thái không hợp lệ.';
  }
  return { fields, name, phone: phone ?? '', email, reason };
}
