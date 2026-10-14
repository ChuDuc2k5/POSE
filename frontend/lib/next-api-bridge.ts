import 'server-only';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { backendFetch } from './backend';
import type { Role } from './roles';

// Temporary M08 bridge. NestJS remains the sole session verifier.
export async function authenticatedSession() {
  const response = await backendFetch('/api/auth/session');
  if (!response.ok) throw new Error('AUTH_UNAVAILABLE');
  const jar = await cookies();
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(';')[0], index = pair.indexOf('=');
    const name = pair.slice(0, index);
    if (!['pose-access', 'pose-refresh'].includes(name)) continue;
    const maxAge = header.match(/Max-Age=(\d+)/i)?.[1];
    jar.set(name, decodeURIComponent(pair.slice(index + 1)), {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/',
      ...(maxAge ? { maxAge: Number(maxAge) } : {}),
    });
  }
  const session = await response.json() as { user: { id: string }; role: Role } | null;
  if (!session) return null;
  const access = jar.get('pose-access')?.value;
  if (!access) throw new Error('AUTH_UNAVAILABLE');
  return { ...session, access };
}
export function authClient(access?: string) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('AUTH_NOT_CONFIGURED');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(access ? { global: { headers: { Authorization: `Bearer ${access}` } } } : {}),
  });
}
export function catalogJson(body: object, status = 200) { return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } }); }
export function catalogError(code: string, message: string, status: number, field_errors: Record<string,string> = {}) {
  return catalogJson({ code, message, field_errors, correlation_id: randomUUID() }, status);
}
export async function catalogAdmin(request?: NextRequest) {
  if (request && request.headers.get('origin')!==request.nextUrl.origin) return { error: catalogError('INVALID_ORIGIN','Yêu cầu không hợp lệ.',403) } as const;
  const session = await authenticatedSession();
  if (!session) return { error: catalogError('UNAUTHORIZED','Vui lòng đăng nhập.',401) } as const;
  if (session.role !== 'Admin') return { error: catalogError('FORBIDDEN','Bạn không có quyền quản lý bất động sản.',403) } as const;
  return { session, client: authClient(session.access) } as const;
}
export function catalogDatabaseError(error: { code?: string; message?: string }) {
  if (error.code === '40001') return catalogError('VERSION_CONFLICT','Dữ liệu đã được cập nhật ở nơi khác. Tải lại trước khi lưu.',409);
  if (error.code === '23505') return catalogError('DUPLICATE_CODE','Mã đã tồn tại. Vui lòng dùng mã khác.',409,{code:'Mã đã tồn tại.'});
  if (error.code === 'P0002') return catalogError('NOT_FOUND','Không tìm thấy dữ liệu.',404);
  if (error.code === '42501') return catalogError('FORBIDDEN','Quyền truy cập đã thay đổi. Vui lòng đăng nhập lại.',403);
  if (error.message?.includes('REASON_REQUIRED')) return catalogError('REASON_REQUIRED','Nhập lý do khi ẩn, lưu trữ hoặc thay đổi tình trạng mở bán.',400,{reason:'Nhập lý do thay đổi (ít nhất 3 ký tự).'});
  if (error.message?.includes('PARENT_INACTIVE') || error.code === '23503') return catalogError('INVALID_PARENT','Dự án/phân khu không tồn tại, đã lưu trữ hoặc không cùng dự án.',400,{project_id:'Kiểm tra dự án và phân khu.'});
  if (['22023','22P02','23514','23502','22003'].includes(error.code || '')) return catalogError('INVALID_INPUT','Dữ liệu không hợp lệ. Kiểm tra các trường bắt buộc, giá, diện tích và trạng thái công bố.',400);
  return catalogError('CATALOG_UNAVAILABLE','Không thể xử lý dữ liệu. Vui lòng thử lại.',503);
}
export async function catalogInput(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 24000) return { error: catalogError('PAYLOAD_TOO_LARGE','Dữ liệu quá lớn.',413) } as const;
  try {
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    return { input: input as Record<string, unknown> } as const;
  } catch { return { error: catalogError('INVALID_JSON','Dữ liệu không hợp lệ.',400) } as const; }
}

// System/AI actor. Only for RPCs granted to service_role (pose_system_*);
// never use it to read data on behalf of a signed-in user.
export function systemClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('SYSTEM_NOT_CONFIGURED');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

// Scheduler/worker endpoints are triggered with `Authorization: Bearer $CRON_SECRET`.
export function cronAuthorized(header: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7)), expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
