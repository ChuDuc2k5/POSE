import { createHmac } from 'node:crypto';
import type { WebRequest } from '../../common/http.js';
import { validOrigin } from '../../common/http.js';
import { uuidPattern } from '../../common/catalog.js';
import { salesInput, salesListInput } from '../../common/sales-validation.js';
import { accountEvents } from '../../common/account-events.js';
import { authenticatedSession, authClient, consumeAttempt } from '../auth/session.js';
import { systemClient } from '../supabase/supabase.service.js';
import { catalogError, catalogInput, catalogJson } from '../catalog/catalog.service.js';
import { formerDistricts } from '../ai/ward-label.js';

function territoryInput(input: Record<string, unknown>) {
  const fields: Record<string, string> = {};
  const districts = input.districts,
    backup = input.backup;
  if (Object.keys(input).some((key) => !['districts', 'backup'].includes(key)))
    fields.form = 'Only valid territory fields are accepted.';
  for (const [key, value] of [
    ['districts', districts],
    ['backup', backup],
  ] as const) {
    if (
      !Array.isArray(value) ||
      value.length > 100 ||
      value.some((item) => typeof item !== 'string' || !formerDistricts.includes(item))
    )
      fields[key] = 'Territory is invalid.';
    else if (new Set(value).size !== value.length) fields[key] = 'Territories must be unique.';
  }
  return { fields, districts: districts as string[], backup: backup as string[] };
}

async function admin(request?: WebRequest) {
  if (request && !validOrigin(request))
    return { error: catalogError('INVALID_ORIGIN', 'Yêu cầu không hợp lệ.', 403) } as const;
  const session = await authenticatedSession();
  if (!session) return { error: catalogError('UNAUTHORIZED', 'Vui lòng đăng nhập.', 401) } as const;
  if (session.role !== 'Admin')
    return { error: catalogError('FORBIDDEN', 'Chỉ Admin được quản lý nhân viên Sales.', 403) } as const;
  return { session, client: authClient(session.access) } as const;
}
function databaseError(error: { code?: string; message?: string }) {
  if (error.code === '42501')
    return catalogError('FORBIDDEN', 'Quyền quản trị đã thay đổi. Vui lòng đăng nhập lại.', 403);
  if (error.code === 'P0002') return catalogError('NOT_FOUND', 'Không tìm thấy tài khoản Sales.', 404);
  if (error.code === '40001')
    return catalogError(
      'VERSION_CONFLICT',
      'Thông tin đã được cập nhật ở nơi khác. Đóng cửa sổ và tải lại danh sách.',
      409,
    );
  if (error.code === '23505')
    return catalogError('EMAIL_EXISTS', 'Email đã được sử dụng.', 409, { email: 'Email đã được sử dụng.' });
  if (['22023', '22P02', '23514', '23502'].includes(error.code || ''))
    return catalogError('INVALID_INPUT', 'Dữ liệu Sales không hợp lệ.', 400);
  return catalogError('UNAVAILABLE', 'Chưa thể xử lý dữ liệu Sales. Vui lòng thử lại.', 503);
}
export async function LIST(request: WebRequest) {
  try {
    const access = await admin();
    if (access.error) return access.error;
    const input = salesListInput(request.nextUrl.searchParams);
    if (input.invalid) return catalogError('INVALID_FILTER', 'Bộ lọc hoặc trang không hợp lệ.', 400);
    const result = await access.client.rpc('pose_admin_sales_list', {
      p_query: input.query,
      p_status: input.status,
      p_page: input.page,
      p_size: input.size,
    });
    return result.error ? databaseError(result.error) : catalogJson(result.data);
  } catch {
    return catalogError('UNAVAILABLE', 'Chưa thể tải danh sách Sales.', 503);
  }
}
export async function DETAIL(_request: WebRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await admin();
    if (access.error) return access.error;
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return catalogError('INVALID_ID', 'Mã Sales không hợp lệ.', 400);
    const result = await access.client.rpc('pose_admin_sales_detail', { p_id: id });
    return result.error ? databaseError(result.error) : catalogJson(result.data);
  } catch {
    return catalogError('UNAVAILABLE', 'Chưa thể tải thông tin Sales.', 503);
  }
}
export async function HISTORY(request: WebRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await admin();
    if (access.error) return access.error;
    const { id } = await context.params,
      params = request.nextUrl.searchParams,
      page = Number(params.get('page') ?? 1);
    if (
      !uuidPattern.test(id) ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 10000 ||
      [...params.keys()].some((key) => key !== 'page' || params.getAll(key).length !== 1)
    )
      return catalogError('INVALID_INPUT', 'Yêu cầu lịch sử không hợp lệ.', 400);
    const result = await access.client.rpc('pose_admin_sales_history', { p_id: id, p_page: page });
    return result.error ? databaseError(result.error) : catalogJson(result.data);
  } catch {
    return catalogError('UNAVAILABLE', 'Chưa thể tải lịch sử Sales.', 503);
  }
}
export async function TERRITORIES(_request: WebRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await admin();
    if (access.error) return access.error;
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return catalogError('INVALID_ID', 'Sales identifier is invalid.', 400);
    const result = await access.client.rpc('pose_admin_sales_territories', { p_sales: id });
    return result.error ? databaseError(result.error) : catalogJson({ ...result.data, available: formerDistricts });
  } catch {
    return catalogError('UNAVAILABLE', 'Sales territories are unavailable.', 503);
  }
}
export async function SET_TERRITORIES(request: WebRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await admin(request);
    if (access.error) return access.error;
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return catalogError('INVALID_ID', 'Sales identifier is invalid.', 400);
    const body = await catalogInput(request);
    if (body.error) return body.error;
    const value = territoryInput(body.input);
    if (Object.keys(value.fields).length)
      return catalogError('INVALID_INPUT', 'Check Sales territories.', 400, value.fields);
    const result = await access.client.rpc('pose_admin_set_sales_territories', {
      p_sales: id,
      p_districts: value.districts,
      p_backup: value.backup,
    });
    return result.error ? databaseError(result.error) : catalogJson(result.data);
  } catch {
    return catalogError('UNAVAILABLE', 'Sales territories could not be saved.', 503);
  }
}
export async function CREATE(request: WebRequest) {
  try {
    const access = await admin(request);
    if (access.error) return access.error;
    const body = await catalogInput(request);
    if (body.error) return body.error;
    const value = salesInput(body.input, 'create');
    if (Object.keys(value.fields).length)
      return catalogError('INVALID_INPUT', 'Kiểm tra thông tin tạo Sales.', 400, value.fields);
    if (!consumeAttempt('sales-create', access.session.user.id, 30))
      return catalogError('RATE_LIMITED', 'Bạn tạo tài khoản quá nhanh. Vui lòng thử lại sau.', 429);
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!secret) return catalogError('UNAVAILABLE', 'Dịch vụ tạo tài khoản chưa được cấu hình.', 503);
    const id = body.input.request_key as string;
    const fingerprint = createHmac('sha256', secret)
      .update(JSON.stringify([value.email, value.name, value.phone, body.input.password]))
      .digest('hex');
    const provider = systemClient();
    let lookup = await provider.auth.admin.getUserById(id);
    if (lookup.error && lookup.error.status !== 404 && lookup.error.code !== 'user_not_found')
      return catalogError('UNAVAILABLE', 'Chưa thể kiểm tra tài khoản. Vui lòng thử lại.', 503);
    if (!lookup.data.user) {
      const created = await provider.auth.admin.createUser({
        id,
        email: value.email,
        password: body.input.password as string,
        email_confirm: true,
        user_metadata: { display_name: value.name },
        app_metadata: {
          role: 'Sales',
          account_status: 'suspended',
          m11_pending: true,
          m11_request_key: id,
          m11_created_by: access.session.user.id,
          m11_fingerprint: fingerprint,
          m11_profile: { name: value.name, phone: value.phone },
        },
      });
      if (created.error) {
        // The provider may have committed before a network timeout. Retry only
        // this caller-chosen UUID; never search for or take over another user.
        lookup = await provider.auth.admin.getUserById(id);
        if (!lookup.data.user) {
          if (['email_exists', 'user_already_exists', 'email_address_exists'].includes(created.error.code || ''))
            return catalogError('EMAIL_EXISTS', 'Email đã được sử dụng.', 409, { email: 'Email đã được sử dụng.' });
          if (created.error.code === 'weak_password')
            return catalogError('INVALID_INPUT', 'Mật khẩu chưa đáp ứng chính sách tài khoản.', 400, {
              password: 'Dùng mật khẩu mạnh hơn, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.',
            });
          return catalogError('UNAVAILABLE', 'Chưa thể tạo tài khoản. Thử lại với cùng thông tin.', 503);
        }
      } else lookup = created;
    }
    const metadata = lookup.data.user?.app_metadata;
    if (
      !metadata ||
      metadata.m11_created_by !== access.session.user.id ||
      metadata.m11_request_key !== id ||
      metadata.m11_fingerprint !== fingerprint
    )
      return catalogError(
        'REQUEST_CONFLICT',
        'Mã yêu cầu đã được dùng với thông tin khác. Đóng cửa sổ và tạo yêu cầu mới.',
        409,
      );
    const result = await access.client.rpc('pose_admin_sales_finish_create', { p_id: id, p_key: id });
    if (result.error) {
      if (['42501', 'P0002'].includes(result.error.code || '')) return databaseError(result.error);
      return catalogError(
        'ACTIVATION_PENDING',
        'Tài khoản đang tạm khóa. Tải lại danh sách để kích hoạt hoặc thử lại cùng thông tin.',
        503,
      );
    }
    return catalogJson(result.data, result.data.replayed ? 200 : 201);
  } catch {
    return catalogError('UNAVAILABLE', 'Chưa thể tạo Sales. Thử lại với cùng thông tin.', 503);
  }
}
export async function UPDATE(request: WebRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await admin(request);
    if (access.error) return access.error;
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return catalogError('INVALID_ID', 'Mã Sales không hợp lệ.', 400);
    const body = await catalogInput(request);
    if (body.error) return body.error;
    const value = salesInput(body.input, 'update');
    if (Object.keys(value.fields).length)
      return catalogError('INVALID_INPUT', 'Kiểm tra thông tin Sales.', 400, value.fields);
    const result = await access.client.rpc('pose_admin_sales_update', {
      p_id: id,
      p_data: { name: value.name, phone: value.phone },
      p_version: body.input.version,
      p_profile_version: body.input.profile_version,
      p_reason: value.reason,
    });
    return result.error ? databaseError(result.error) : catalogJson(result.data);
  } catch {
    return catalogError('UNAVAILABLE', 'Chưa thể cập nhật Sales.', 503);
  }
}
export async function STATUS(request: WebRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await admin(request);
    if (access.error) return access.error;
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return catalogError('INVALID_ID', 'Mã Sales không hợp lệ.', 400);
    const body = await catalogInput(request);
    if (body.error) return body.error;
    const value = salesInput(body.input, 'status');
    if (Object.keys(value.fields).length)
      return catalogError('INVALID_INPUT', 'Kiểm tra yêu cầu đổi trạng thái.', 400, value.fields);
    const result = await access.client.rpc('pose_admin_sales_status', {
      p_id: id,
      p_status: body.input.status,
      p_version: body.input.version,
      p_reason: value.reason,
    });
    if (result.error) return databaseError(result.error);
    if (result.data.status === 'suspended') accountEvents.emit('revoked', id);
    return catalogJson(result.data);
  } catch {
    return catalogError('UNAVAILABLE', 'Chưa thể đổi trạng thái Sales.', 503);
  }
}
