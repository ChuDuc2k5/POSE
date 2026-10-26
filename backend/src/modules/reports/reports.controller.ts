import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../auth/auth.guard.js';
import { dispatch } from '../../common/http.js';
import * as handlers from './reports.handlers.js';

@Public()
@Controller('reports')
export class ReportsController {
  @Get('leads') leads(@Req() req: Request, @Res() res: Response) { return dispatch(req, res, handlers.leads); }
  @Get('options') options(@Req() req: Request, @Res() res: Response) { return dispatch(req, res, handlers.options); }
}
