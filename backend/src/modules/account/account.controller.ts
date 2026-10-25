import { Controller, Req, Res, Get, Post, Patch } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../auth/auth.guard.js';
import { dispatch } from '../../common/http.js';
import * as avatar from './account-avatar.handlers.js';
import * as profile from './account-profile.handlers.js';
import * as phone from './account-phone-action.handlers.js';
import * as contactConsents from './contact-consents.handlers.js';

// Handlers enforce session, role and origin checks to preserve existing error responses.
@Controller()
export class AccountController {
  @Post('account/avatar')
  @Public()
  uploadAvatar(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, avatar.POST); }
  @Get('account/profile')
  @Public()
  readProfile(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, profile.GET); }
  @Patch('account/profile')
  @Public()
  updateProfile(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, profile.PATCH); }
  @Post('account/phone/:action')
  @Public()
  phoneAction(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, phone.POST); }
  @Get('account/contact-consents')
  @Public()
  readContactConsents(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, contactConsents.GET); }
  @Post('account/contact-consents')
  @Public()
  writeContactConsent(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, contactConsents.POST); }
}
