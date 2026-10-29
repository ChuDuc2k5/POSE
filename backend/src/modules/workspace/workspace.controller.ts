import { Controller, Req, Res, Get } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../auth/auth.guard.js';
import { dispatch } from '../../common/http.js';
import * as workspace from './workspace-role.handlers.js';

// Handlers enforce session, role and origin checks to preserve existing error responses.
@Controller()
export class WorkspaceController {
  @Get('workspace/:role')
  @Public()
  readWorkspace(@Req() request: Request, @Res() response: Response) {
    return dispatch(request, response, workspace.GET);
  }
}
