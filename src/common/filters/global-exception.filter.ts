import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';

type RequestWithContext = Request & {
  id?: string;
  requestId?: string;
};

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(GlobalExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const request = httpContext.getRequest<RequestWithContext>();
    const response = httpContext.getResponse<Response>();

    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;

    const normalizedMessage = this.normalizeMessage(exceptionResponse, exception);
    const requestId = request.requestId ?? request.id;
    const errorPayload = {
      statusCode,
      timestamp: new Date().toISOString(),
      path: request.originalUrl ?? request.url,
      requestId,
      message: normalizedMessage,
    };

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        {
          err: exception,
          requestId,
          statusCode,
          method: request.method,
          path: request.originalUrl ?? request.url,
        },
        'Unhandled exception',
      );
    } else {
      this.logger.warn(
        {
          requestId,
          statusCode,
          method: request.method,
          path: request.originalUrl ?? request.url,
          message: normalizedMessage,
        },
        'Handled exception',
      );
    }

    response.status(statusCode).json(errorPayload);
  }

  private normalizeMessage(
    exceptionResponse: unknown,
    exception: unknown,
  ): string | string[] {
    if (typeof exceptionResponse === 'string') {
      return exceptionResponse;
    }

    if (
      exceptionResponse &&
      typeof exceptionResponse === 'object' &&
      'message' in exceptionResponse
    ) {
      const { message } = exceptionResponse as { message?: string | string[] };
      return message ?? 'Unexpected error';
    }

    if (exception instanceof Error) {
      return exception.message;
    }

    return 'Unexpected error';
  }
}
