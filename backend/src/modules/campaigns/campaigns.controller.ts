import { Controller, Get, Post, Patch, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../auth/auth.guard.js';
import { dispatch } from '../../common/http.js';
import { campaignRoute } from './campaigns.handlers.js';
import { CampaignsScheduler } from './campaigns.scheduler.js';

// The handlers enforce Admin sessions and mutation origins, preserving the HTTP contract.
@Public()
@Controller('admin/campaigns')
export class CampaignsController {
  constructor(private readonly scheduler: CampaignsScheduler) {}
  @Get()
  list(@Req() req: Request, @Res() res: Response) { return this.handle(req, res); }
  @Post()
  create(@Req() req: Request, @Res() res: Response) { return this.handle(req, res); }
  @Get('*path')
  read(@Req() req: Request, @Res() res: Response) { return this.handle(req, res); }
  @Post('*path')
  mutate(@Req() req: Request, @Res() res: Response) { return this.handle(req, res); }
  @Patch('*path')
  edit(@Req() req: Request, @Res() res: Response) { return this.handle(req, res); }
  private handle(req: Request, res: Response) {
    return dispatch(req, res, request => campaignRoute(request, request.nextUrl.pathname.split('/').slice(4), () => this.scheduler.status()));
  }
}

@Public()
@Controller('system/campaigns')
export class CampaignsTickController {
  constructor(private readonly scheduler: CampaignsScheduler) {}
  @Post('tick')
  tick(@Req() req: Request, @Res() res: Response) { return dispatch(req, res, request => this.scheduler.httpTick(request)); }
}
