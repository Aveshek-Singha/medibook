import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { RequestWithRequestId } from '../interfaces/request-with-request-id.interface';

export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  requestId: string;
  path: string;
  timestamp: string;
}

/**
 * Single error shape for the whole API.
 *
 * Stack traces never leak in the response; `requestId` always matches the
 * `X-Request-Id` response header so a user-reported error can be found in logs.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithRequestId>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const requestId = this.resolveRequestId(request);

    let message: string | string[] = 'Internal server error';
    let error = HttpStatus[status] ?? 'Error';

    if (
      exception instanceof HttpException &&
      status < HttpStatus.INTERNAL_SERVER_ERROR
    ) {
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        message = payload;
      } else {
        const body = payload as { message?: string | string[]; error?: string };
        message = body.message ?? exception.message;
        error = body.error ?? error;
      }
    }

    const body: ErrorResponseBody = {
      statusCode: status,
      error,
      message,
      requestId,
      path: request.originalUrl ?? request.url,
      timestamp: new Date().toISOString(),
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        {
          requestId,
          method: request.method,
          path: body.path,
          statusCode: status,
          stack:
            exception instanceof Error ? exception.stack : String(exception),
        },
        'Request failed',
      );
    } else {
      this.logger.warn(
        {
          requestId,
          method: request.method,
          path: body.path,
          statusCode: status,
        },
        'Request rejected',
      );
    }

    response.status(status).json(body);
  }

  private resolveRequestId(request: RequestWithRequestId): string {
    const id = request.id;
    if (id === undefined || id === null) {
      return 'unknown';
    }
    return String(id);
  }
}
