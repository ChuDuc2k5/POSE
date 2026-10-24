import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public, Roles } from '../../auth/auth.guard.js';
import { dispatch } from '../../common/http.js';
import { AiService } from './ai.service.js';
import { KnowledgeIndexer } from './indexing.js';
import { validOrigin } from '../../common/http.js';
import { catalogError, catalogJson } from '../catalog/catalog.service.js';
import * as workspace from './workspace.handlers.js';
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService,private readonly indexer:KnowledgeIndexer) {}
  @Public()
  @Post('chat')
  chat(@Req() req: Request, @Res() res: Response) { return dispatch(req, res, request => this.ai.chat(request)); }
  @Public()
  @Post('chat/stream')
  chatStream(@Req() req: Request, @Res() res: Response) { return dispatch(req, res, request => this.ai.chat(request)); }
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
  @Public()
  @Post('actions/:id/confirm')
  confirm(@Req() req: Request, @Res() res: Response) { return dispatch<{id:string}>(req, res, async (request, context) => this.ai.decideAction(request, (await context.params).id, true)); }
  @Public()
  @Post('actions/:id/cancel')
  cancel(@Req() req: Request, @Res() res: Response) { return dispatch<{id:string}>(req, res, async (request, context) => this.ai.decideAction(request, (await context.params).id, false)); }
  @Roles('Admin')
  @Post('admin/reindex')
  reindex(@Req() req: Request,@Res() res:Response){return dispatch(req,res,async request=>{
    if(!validOrigin(request))return catalogError('INVALID_ORIGIN','Yêu cầu không hợp lệ.',403);
    try{return catalogJson(await this.indexer.reindexAll());}catch{return catalogError('INDEX_UNAVAILABLE','Không thể lập lại chỉ mục tri thức.',503);}
  });}
}

@Controller('admin/ai')
export class AdminAiController {
  constructor(private readonly indexer:KnowledgeIndexer, private readonly ai:AiService) {}
  @Roles('Admin')
  @Post('reindex')
  reindex(@Req() req:Request,@Res() res:Response){return dispatch(req,res,async request=>{
    if(!validOrigin(request))return catalogError('INVALID_ORIGIN','Yêu cầu không hợp lệ.',403);
    try{return catalogJson(await this.indexer.reindexAll());}catch{return catalogError('INDEX_UNAVAILABLE','Không thể lập lại chỉ mục tri thức.',503);}
  });}
  @Get('usage')
  usage(@Req() req:Request,@Res() res:Response){return dispatch(req,res,request=>this.ai.getUsage(request));}
}

@Controller('admin')
export class AdminUsageController {
  constructor(private readonly ai: AiService) {}
  @Roles('Admin')
  @Get('ai-usage')
  usage(@Req() req: Request, @Res() res: Response) { return dispatch(req, res, request => this.ai.getUsage(request)); }
}
