import { Controller, Req, Res, Get, Post, Put, Delete } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../auth/auth.guard.js';
import { dispatch } from '../../common/http.js';
import * as favorites from './customer-favorites.handlers.js';
import * as inquiries from './customer-inquiries.handlers.js';
import * as confirmation from './customer-inquiries-id-confirm.handlers.js';
import * as favoriteStatus from './customer-favorites-status.handlers.js';
import * as favorite from './customer-favorites-id.handlers.js';

// Handlers enforce session, role and origin checks to preserve existing error responses.
@Controller()
export class CustomerController {
  @Get('customer/favorites')
  @Public()
  listFavorites(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, favorites.GET); }
  @Get('customer/inquiries')
  @Public()
  listInquiries(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, inquiries.GET); }
  @Post('customer/inquiries')
  @Public()
  submitInquiry(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, inquiries.POST); }
  @Post('customer/inquiries/:id/confirm')
  @Public()
  confirmInquiry(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, confirmation.POST); }
  @Get('customer/favorites/status')
  @Public()
  favoriteStatus(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, favoriteStatus.GET); }
  @Put('customer/favorites/:id')
  @Public()
  saveFavorite(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, favorite.PUT); }
  @Delete('customer/favorites/:id')
  @Public()
  removeFavorite(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, favorite.DELETE); }
}
