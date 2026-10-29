import { Controller, Get, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../auth/auth.guard.js';
import { dispatch } from '../../common/http.js';
import * as handlers from './appointments.handlers.js';
@Public()
@Controller('appointments')
export class AppointmentsController {
  @Get() list(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, handlers.list);
  }
  @Get('options') options(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, handlers.options);
  }
  @Get('sales-suggestions') salesSuggestions(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, handlers.salesSuggestions);
  }
  @Get(':id') detail(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, handlers.detail);
  }
  @Post() create(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, handlers.create);
  }
  @Patch(':id') save(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, handlers.save);
  }
}
