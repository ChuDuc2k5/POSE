import { RequestMethod, type INestApplication } from '@nestjs/common';
import { ErrorFilter } from './common/error.filter.js';
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api', { exclude: [ { path: 'auth/confirm', method: RequestMethod.GET }, { path: 'auth/refresh', method: RequestMethod.GET } ] });
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
}
