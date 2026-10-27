import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { authenticatedSession } from '../modules/auth/session.js';
import { withCookieContext } from '../common/http.js';
export type Role = 'User' | 'Sales' | 'Admin';
export type Principal = { id: string; email: string; role: Role };
export type AuthorizedRequest = Request & { principal: Principal };
export const Public = () => SetMetadata('pose:public', true);
export const Roles = (...roles: Role[]) => SetMetadata('pose:roles', roles);
export function assertResourceOwner(principal: Principal, ownerId: string) {
  if (principal.role !== 'Admin' && principal.id !== ownerId)
    throw new ForbiddenException('Bạn không có quyền truy cập dữ liệu này.');
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext) {
    // Socket sessions are checked by the gateway middleware and message handler.
    if (context.getType?.() === 'ws') return true;
    if (this.reflector.getAllAndOverride<boolean>('pose:public', [context.getHandler(), context.getClass()]))
      return true;
    const request = context.switchToHttp().getRequest<AuthorizedRequest>();
    if (!request.headers.cookie && !request.headers.authorization)
      throw new UnauthorizedException('Vui lòng đăng nhập.');
    let session;
    try {
      session = await withCookieContext(request, request.res, () => authenticatedSession());
    } catch {
      throw new ServiceUnavailableException('Dịch vụ xác thực chưa khả dụng.');
    }
    if (!session) throw new UnauthorizedException('Vui lòng đăng nhập.');
    const roles = this.reflector.getAllAndOverride<Role[]>('pose:roles', [context.getHandler(), context.getClass()]);
    if (roles && !roles.includes(session.role))
      throw new ForbiddenException('Bạn không có quyền thực hiện chức năng này.');
    request.principal = { id: session.user.id, email: session.user.email || '', role: session.role };
    request.res?.setHeader('Cache-Control', 'no-store');
    return true;
  }
}
