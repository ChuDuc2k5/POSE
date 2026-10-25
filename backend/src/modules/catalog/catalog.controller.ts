import { Controller, Req, Res, Get, Post, Patch, Delete } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../auth/auth.guard.js';
import { dispatch } from '../../common/http.js';
import * as projects from './catalog-projects.handlers.js';
import * as properties from './catalog-properties.handlers.js';
import * as search from './catalog-search.handlers.js';
import * as property from './catalog-properties-id.handlers.js';
import * as similar from './catalog-similar.handlers.js';
import * as media from './catalog-media-id.handlers.js';
import * as adminCatalog from './admin-catalog-kind.handlers.js';
import * as adminItem from './admin-catalog-kind-id.handlers.js';
import * as upload from './admin-catalog-properties-id-media.handlers.js';
import * as propertyView from './catalog-property-view.handlers.js';
import * as lifecycle from './catalog-lifecycle.handlers.js';

// Handlers enforce session, role and origin checks to preserve existing error responses.
@Controller()
export class CatalogController {
  @Delete('admin/catalog/properties/:id')
  @Public()
  trashProperty(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, lifecycle.DELETE); }
  @Post('admin/catalog/properties/:id/restore')
  @Public()
  restoreProperty(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, lifecycle.RESTORE); }
  @Get('catalog/projects')
  @Public()
  listProjects(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, projects.GET); }
  @Get('catalog/properties')
  @Public()
  listProperties(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, properties.GET); }
  @Get('catalog/search')
  @Public()
  search(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, search.GET); }
  @Get('catalog/properties/:id')
  @Public()
  readProperty(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, property.GET); }
  @Post('catalog/properties/:id/view')
  @Public()
  recordPropertyView(@Req() request: Request, @Res() response: Response) { return dispatch<{id:string}>(request, response, propertyView.POST); }
  @Get('properties/:id/similar')
  @Public()
  similarProperties(@Req() request: Request, @Res() response: Response) { return dispatch<{id:string}>(request, response, similar.GET); }
  @Get('catalog/media/:id')
  @Public()
  downloadMedia(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, media.GET); }
  @Get('admin/catalog/:kind')
  @Public()
  listAdminCatalog(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, adminCatalog.GET); }
  @Post('admin/catalog/:kind')
  @Public()
  createCatalogItem(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, adminCatalog.POST); }
  @Get('admin/catalog/:kind/:id')
  @Public()
  readCatalogItem(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, adminItem.GET); }
  @Patch('admin/catalog/:kind/:id')
  @Public()
  updateCatalogItem(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, adminItem.PATCH); }
  @Post('admin/catalog/properties/:id/media')
  @Public()
  uploadPropertyMedia(@Req() request: Request, @Res() response: Response) { return dispatch(request, response, upload.POST); }
}
