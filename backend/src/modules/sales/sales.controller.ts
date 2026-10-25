import { Controller, Get, Patch, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../auth/auth.guard.js';
import { dispatch } from '../../common/http.js';
import * as handlers from './sales.handlers.js';

@Public()
@Controller('sales')
export class SalesController {
  @Get('options') options(@Req() req: Request, @Res() res: Response) { return dispatch(req, res, handlers.options); }
  @Get('leads') leads(@Req() req: Request, @Res() res: Response) { return dispatch(req, res, handlers.leads); }
  @Get('leads/:id') detail(@Req() req: Request, @Res() res: Response) { return dispatch(req, res, handlers.detail); }
  @Patch('leads/:id') mutate(@Req() req: Request, @Res() res: Response) { return dispatch(req, res, handlers.mutate); }
  @Get('activities') activities(@Req() req: Request, @Res() res: Response) { return dispatch(req, res, handlers.activities); }
  @Get('properties') properties(@Req() req: Request, @Res() res: Response) { return dispatch(req, res, handlers.properties); }
  @Get('properties/:id') property(@Req() req: Request, @Res() res: Response) { return dispatch(req, res, handlers.property); }
  @Get('media/:id') media(@Req() req: Request, @Res() res: Response) { return dispatch(req, res, handlers.media); }
}
