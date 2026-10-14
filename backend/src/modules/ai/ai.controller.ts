import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../auth/auth.guard.js';
import { dispatch } from '../../common/http.js';
import { AiService } from './ai.service.js';
import * as workspace from './workspace.handlers.js';
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}
  @Public()
  @Post('chat')
  chat(@Req() req: Request, @Res() res: Response) { return dispatch(req, res, request => this.ai.chat(request)); }
  @Public()
  @Get('sessions/:id')
  session(@Req() req: Request, @Res() res: Response) { return dispatch<{id:string}>(req, res, async (request, context) => this.ai.getChat(request, (await context.params).id)); }
  @Public()
  @Post('handoff')
  handoff(@Req() req: Request, @Res() res: Response) { return dispatch(req, res, request => this.ai.handoff(request)); }
  @Public()
  @Get('workspace')
  workspace(@Req() req: Request, @Res() res: Response) { return dispatch(req, res, workspace.GET); }
  @Public()
  @Post('workspace')
  override(@Req() req: Request, @Res() res: Response) { return dispatch(req, res, workspace.POST); }
}
