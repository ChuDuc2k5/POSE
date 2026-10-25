import { Controller, Get, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../auth/auth.guard.js';
import { dispatch } from '../../common/http.js';
import * as sales from './admin-sales.handlers.js';

@Controller('admin/sales')
export class AdminSalesController {
  @Get() @Public() list(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, sales.LIST); }
  @Post() @Public() create(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, sales.CREATE); }
  @Get(':id') @Public() detail(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, sales.DETAIL); }
  @Patch(':id') @Public() update(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, sales.UPDATE); }
  @Post(':id/status') @Public() status(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, sales.STATUS); }
  @Get(':id/history') @Public() history(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, sales.HISTORY); }
}
