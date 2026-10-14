import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 503;
    const codes: Record<number,string> = { 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 413: 'PAYLOAD_TOO_LARGE' };
    response.status(status).setHeader('Cache-Control','no-store');
    response.json({ code: codes[status] || 'UNAVAILABLE', message: error instanceof HttpException ? error.message : 'Dịch vụ tạm thời chưa khả dụng. Vui lòng thử lại.', field_errors: {}, correlation_id: randomUUID() });
  }
}
