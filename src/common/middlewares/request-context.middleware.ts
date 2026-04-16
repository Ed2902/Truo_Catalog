import { randomUUID } from 'crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

type RequestWithContext = Request & {
  requestId?: string;
  requestStartedAt?: number;
};

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: RequestWithContext, response: Response, next: NextFunction): void {
    const requestIdHeader = request.headers['x-request-id'];
    const requestId =
      (Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader) ??
      randomUUID();

    request.requestId = requestId;
    request.requestStartedAt = Date.now();
    response.setHeader('x-request-id', requestId);

    next();
  }
}
