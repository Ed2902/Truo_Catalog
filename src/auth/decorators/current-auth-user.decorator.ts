import {
  UnauthorizedException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import { RequestWithAuthenticatedUser } from '../interfaces/authenticated-request.interface';

export const CurrentAuthUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request =
      context.switchToHttp().getRequest<RequestWithAuthenticatedUser>();

    if (!request.user) {
      throw new UnauthorizedException('Authentication context is missing');
    }

    return request.user;
  },
);
