import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { authenticatedSession, authClient } from './auth-server';
import type { CatalogKind } from './catalog';

export const catalogTables: Record<CatalogKind, string> = { projects: 'property_projects', subdivisions: 'property_subdivisions', properties: 'property_products', media: 'property_media' };
export function catalogJson(body: object, status = 200) { return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } }); }
export function catalogError(code: string, message: string, status: number, field_errors: Record<string,string> = {}) {
  return catalogJson({ code, message, field_errors, correlation_id: randomUUID() }, status);
}
export async function catalogAdmin(request?: NextRequest) {
  if (request && request.headers.get('origin') !== request.nextUrl.origin) return { error: catalogError('INVALID_ORIGIN','Yêu cầu không hợp lệ.',403) } as const;
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

export async function catalogMultipart(request: NextRequest, limit: number) {
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data') || !request.body) throw new Error('INVALID_MULTIPART');
  const reader=request.body.getReader(); const chunks:Uint8Array[]=[]; let size=0;
  while (true) {
    const chunk=await reader.read(); if (chunk.done) break;
    size+=chunk.value.byteLength;
    if (size>limit) { await reader.cancel(); throw new Error('MULTIPART_TOO_LARGE'); }
    chunks.push(chunk.value);
  }
  const buffer=new Uint8Array(size); let offset=0;
  for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
  return new Response(buffer,{headers:{'Content-Type':request.headers.get('content-type')!}}).formData();
}
