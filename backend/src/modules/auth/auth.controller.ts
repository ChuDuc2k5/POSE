import { Controller, Req, Res, Get, Post } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../auth/auth.guard.js';
import { authenticatedSession } from './session.js';
import { dispatch } from '../../common/http.js';
import * as actions from './auth-action.handlers.js';
import * as confirmation from './confirm.handlers.js';
import * as refresh from './refresh.handlers.js';
import * as google from './google.handlers.js';

// Handlers enforce session, role and origin checks to preserve existing error responses.
@Controller()
export class AuthController {
  @Post('auth/google')
  @Public()
  googleStart(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, google.START); }
  @Get('auth/google/callback')
  @Public()
  googleCallback(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, google.CALLBACK); }
  @Get('auth/session')
  @Public()
  session(@Req() request: Request, @Res() response: Response) {
    return dispatch(request, response, async req => {
      const session = await authenticatedSession({ writable: req.nextUrl.searchParams.get('writable') !== 'false' });
      return globalThis.Response.json(session ? { user: session.user, role: session.role } : null, { headers: { 'Cache-Control': 'no-store' } });
    });
  }
  @Get('auth/:action')
  @Public()
  readAuthAction(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, actions.GET); }
  @Post('auth/:action')
  @Public()
  submitAuthAction(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, actions.POST); }
}

@Controller()
export class AuthCookieController {
  @Get('auth/confirm')
  @Public()
  confirm(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, confirmation.GET); }
  @Get('auth/refresh')
  @Public()
  refresh(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, refresh.GET); }
}
