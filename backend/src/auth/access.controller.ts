import { Controller, Get, Req } from '@nestjs/common';
import { Roles, type AuthorizedRequest } from './auth.guard.js';

@Controller('auth')
export class AccessController {
  @Get('me')
  me(@Req() request: AuthorizedRequest) { return { user: request.principal }; }

  @Get('admin')
  @Roles('Admin')
  admin(@Req() request: AuthorizedRequest) { return { role: request.principal.role, message: 'Bạn có quyền truy cập không gian quản trị.' }; }

  @Get('sales')
  @Roles('Sales', 'Admin')
  sales(@Req() request: AuthorizedRequest) { return { role: request.principal.role, message: 'Bạn có quyền truy cập không gian tư vấn.' }; }
}
