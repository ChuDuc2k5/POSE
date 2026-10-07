import { CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

export type Role = 'User' | 'Sales' | 'Admin';
export type Principal = { id: string; email: string; role: Role };
export type AuthorizedRequest = Request & { principal: Principal };
export const Public = () => SetMetadata('pose:public', true);
export const Roles = (...roles: Role[]) => SetMetadata('pose:roles', roles);

// Use for future customer/Lead/file operations after fetching the resource.
// A role check alone does not authorize access to another person's records.
export function assertResourceOwner(principal: Principal, ownerId: string) {
  if (principal.role !== 'Admin' && principal.id !== ownerId) throw new ForbiddenException('Bạn không có quyền truy cập dữ liệu này.');
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>('pose:public', [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<AuthorizedRequest>();
    const token = request.headers.authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!token || token.length > 8192) throw new UnauthorizedException('Vui lòng đăng nhập.');
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new ServiceUnavailableException('Dịch vụ xác thực chưa được cấu hình.');
    const headers = { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    try {
      const identityResponse = await fetch(`${url}/auth/v1/user`, { headers, signal: AbortSignal.timeout(8000) });
      if ([401, 403].includes(identityResponse.status)) throw new UnauthorizedException('Phiên không hợp lệ.');
      if (!identityResponse.ok) throw new ServiceUnavailableException('Dịch vụ xác thực chưa khả dụng.');
      const identity = await identityResponse.json() as { id?: string; email?: string; email_confirmed_at?: string };
      if (!identity.id || !identity.email_confirmed_at) throw new UnauthorizedException('Tài khoản chưa xác minh.');
      const accessResponse = await fetch(`${url}/rest/v1/rpc/pose_access_context`, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(8000) });
      if ([401, 403].includes(accessResponse.status)) throw new UnauthorizedException('Phiên không hợp lệ.');
      if (!accessResponse.ok) throw new ServiceUnavailableException('Dịch vụ phân quyền chưa khả dụng.');
      const access = await accessResponse.json() as { user_id?: string; role?: Role; active?: boolean; session_valid?: boolean } | null;
      if (!access || access.user_id !== identity.id || !access.active || !access.session_valid) throw new UnauthorizedException('Tài khoản hoặc phiên đã bị vô hiệu hóa.');
      if (!access.role || !['User', 'Sales', 'Admin'].includes(access.role)) throw new ForbiddenException('Vai trò không hợp lệ.');
      const roles = this.reflector.getAllAndOverride<Role[]>('pose:roles', [context.getHandler(), context.getClass()]);
      if (roles && !roles.includes(access.role)) throw new ForbiddenException('Bạn không có quyền thực hiện chức năng này.');
      request.principal = { id: identity.id, email: identity.email || '', role: access.role };
      request.res?.setHeader('Cache-Control', 'no-store');
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Dịch vụ xác thực chưa khả dụng.');
    }
  }
}
