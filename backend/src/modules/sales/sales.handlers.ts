import type { SupabaseClient } from '@supabase/supabase-js';
import { validOrigin, type WebRequest } from '../../common/http.js';
import { uuidPattern } from '../../common/catalog.js';
import { authenticatedSession, authClient } from '../auth/session.js';
import { storageClient } from '../supabase/supabase.service.js';
import { catalogError, catalogInput, catalogJson } from '../catalog/catalog.service.js';
import { leadDatabaseError } from '../leads/leads.handlers.js';
import { salesQuery, validateSalesMutation } from './sales.validation.js';
type Context = { params: Promise<{ id: string }> };
export function salesDatabaseError(error: { code?: string; message?: string }) {
  const message = error.message || '';
  if (message.includes('SALES_LEAD_LOCKED')) return catalogError('LEAD_LOCKED', 'Lead đã kết thúc hoặc lưu trữ. Admin có thể mở lại tại Quản lý Lead.', 409);
  if (message.includes('SALES_PROPERTY_FORBIDDEN')) return catalogError('FORBIDDEN', 'Chỉ được chọn BĐS bạn đang phụ trách.', 403);
  if (['PGRST202', '42P01', '42883'].includes(error.code || '')) return catalogError('SALES_NOT_READY', 'Không gian Sales chưa sẵn sàng. Liên hệ quản trị viên.', 503);
  return leadDatabaseError(error);
}
async function access(request: WebRequest, write = false) {
  if (write && !validOrigin(request)) return { error: catalogError('INVALID_ORIGIN', 'Yêu cầu không hợp lệ.', 403) } as const;
  const s = await authenticatedSession();
  if (!s) return { error: catalogError('UNAUTHORIZED', 'Vui lòng đăng nhập.', 401) } as const;
  if (!['Sales', 'Admin'].includes(s.role) || write && s.role !== 'Sales') return { error: catalogError('FORBIDDEN', 'Admin chỉ xem trong không gian Sales.', 403) } as const;
  return { client: authClient(s.access), role: s.role } as const;
}
async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown> = {}) {
  const result = await client.rpc(name, args);
  return result.error ? salesDatabaseError(result.error) : catalogJson(result.data);
}
export async function options(request: WebRequest) {
  try { const a = await access(request); return 'error' in a ? a.error : rpc(a.client, 'pose_sales_options'); }
  catch { return catalogError('UNAVAILABLE', 'Chưa thể tải thông tin Sales.', 503); }
}
export function listing(kind: 'leads' | 'properties' | 'activities') {
  return async (request: WebRequest) => {
    try {
      const a = await access(request); if ('error' in a) return a.error;
      const q = salesQuery(request.nextUrl.searchParams, kind);
      if (Object.keys(q.fields).length) return catalogError('INVALID_INPUT', 'Kiểm tra bộ lọc.', 400, q.fields);
      if (a.role !== 'Admin' && q.filters.sales_id) return catalogError('FORBIDDEN', 'Bạn chỉ xem danh mục được giao.', 403);
      return rpc(a.client, 'pose_sales_' + kind, { p_filters: q.filters, p_page: q.page, p_size: q.pageSize });
    } catch { return catalogError('UNAVAILABLE', 'Chưa thể tải danh mục Sales.', 503); }
  };
}
export const leads = listing('leads'), properties = listing('properties'), activities = listing('activities');
export function item(kind: 'detail' | 'property') {
  return async (request: WebRequest, context: Context) => {
    try {
      const a = await access(request); if ('error' in a) return a.error;
      const { id } = await context.params; if (!uuidPattern.test(id)) return catalogError('NOT_FOUND', 'Không tìm thấy hồ sơ.', 404);
      return rpc(a.client, 'pose_sales_' + kind, { [kind === 'detail' ? 'p_lead' : 'p_property']: id });
    } catch { return catalogError('UNAVAILABLE', 'Chưa thể tải hồ sơ.', 503); }
  };
}
export const detail = item('detail'), property = item('property');
export async function mutate(request: WebRequest, context: Context) {
  try {
    const a = await access(request, true); if ('error' in a) return a.error;
    const { id } = await context.params; if (!uuidPattern.test(id)) return catalogError('NOT_FOUND', 'Không tìm thấy Lead.', 404);
    const parsed = await catalogInput(request); if ('error' in parsed) return parsed.error;
    const fields = validateSalesMutation(parsed.input);
    if (Object.keys(fields).length) return catalogError('INVALID_INPUT', 'Kiểm tra thông tin tư vấn.', 400, fields);
    return rpc(a.client, 'pose_sales_mutate', { p_lead: id, p_version: parsed.input.version, p_action: parsed.input.action, p_data: parsed.input.data, p_reason: parsed.input.reason || '' });
  } catch { return catalogError('UNAVAILABLE', 'Chưa thể lưu thông tin tư vấn.', 503); }
}
export async function media(request: WebRequest, context: Context) {
  try {
    const a = await access(request); if ('error' in a) return a.error;
    const { id } = await context.params; if (!uuidPattern.test(id)) return catalogError('NOT_FOUND', 'Không tìm thấy tệp.', 404);
    const result = await a.client.rpc('pose_sales_media', { p_media: id });
    if (result.error) return salesDatabaseError(result.error);
    const m = result.data;
    if (!m || !['image/webp', 'application/pdf'].includes(m.mime_type)) return catalogError('FILE_UNAVAILABLE', 'Tệp không khả dụng.', 404);
    if (!process.env.SUPABASE_STORAGE_SECRET_KEY && a.role !== 'Admin') return catalogError('STORAGE_NOT_CONFIGURED', 'Cổng tải tệp chưa được cấu hình.', 503);
    const file = await (a.role === 'Admin' ? a.client : storageClient()).storage.from('property-files').download(m.object_key);
    if (file.error || !file.data) return catalogError('FILE_UNAVAILABLE', 'Chưa thể tải tệp.', 503);
    return new Response(file.data, { headers: { 'Content-Type': m.mime_type, 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Content-Disposition': `${m.mime_type === 'application/pdf' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(m.name + (m.mime_type === 'application/pdf' ? '.pdf' : '.webp'))}` } });
  } catch { return catalogError('FILE_UNAVAILABLE', 'Chưa thể mở tệp.', 503); }
}
