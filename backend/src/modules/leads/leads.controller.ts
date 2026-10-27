import { Controller, Get, Patch, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../auth/auth.guard.js';
import { dispatch } from '../../common/http.js';
import * as handlers from './leads.handlers.js';

// Handlers and RPCs each enforce the current account's role and Lead assignment.
@Public()
@Controller('leads')
export class LeadsController {
  @Get() list(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, handlers.list);
  }
  @Get('options') options(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, handlers.options);
  }
  @Get('property-owners') owners(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, handlers.owners);
  }
  @Put('property-owners/:id') owner(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, handlers.setOwner);
  }
  @Post('recheck') recheck(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, handlers.recheck);
  }
  @Get(':id') detail(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, handlers.detail);
  }
  @Patch(':id') mutate(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, handlers.mutate);
  }
}
