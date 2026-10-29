import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../auth/auth.guard.js';
import { dispatch } from '../../common/http.js';
import { catalogJson } from '../catalog/catalog.service.js';
import * as calling from './server.js';
import { GET as list } from './list.handlers.js';
import { GET as detail } from './detail.handlers.js';
import { POST as playground } from './playground.handlers.js';
import { CallingScheduler } from './calling.scheduler.js';

@Public()
@Controller()
export class CallingController {
  constructor(private readonly scheduler: CallingScheduler) {}
  @Get('calls')
  list(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, list);
  }
  @Get('calls/:id')
  detail(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, detail);
  }
  @Get('calls/:id/recording')
  recording(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, (r) => calling.evidence(r, String(req.params.id), 'recording'));
  }
  @Get('calls/:id/transcript')
  transcript(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, (r) => calling.evidence(r, String(req.params.id), 'transcript'));
  }
  @Post('calls/:id/stop')
  stop(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, (r) => calling.stop(r, String(req.params.id), (id) => this.scheduler.notify(id)));
  }
  @Post('contacts/opt-out')
  optOut(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, (r) => calling.optOut(r, (id) => this.scheduler.notify(id)));
  }
  @Post('admin/calls/test')
  test(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, (r) => calling.testCall(r, (id) => this.scheduler.notify(id)));
  }
  @Post('admin/calls/playground')
  playground(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, playground);
  }
  @Get('admin/calls/worker')
  worker(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, async () => {
      const access = await calling.callAccess(undefined, true);
      return access.error || catalogJson(this.scheduler.status());
    });
  }
  @Post('system/calls/dispatch')
  dispatch(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, (r) => this.scheduler.http(r, 'dispatch'));
  }
  @Post('system/calls/reconcile')
  reconcile(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, (r) => this.scheduler.http(r, 'reconcile'));
  }
  @Post('webhooks/telephony')
  webhook(@Req() req: Request, @Res() res: Response) {
    return dispatch(req, res, (r) => calling.webhook(r, (id) => this.scheduler.notify(id)));
  }
}
