import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import { Request } from 'express';
import { CatalogActor } from '../interfaces/catalog-actor.interface';

function parseBooleanHeader(value?: string): boolean {
  return ['true', '1', 'yes', 'on'].includes((value ?? '').toLowerCase());
}

export const CurrentCatalogActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CatalogActor => {
    const request = context.switchToHttp().getRequest<Request>();
    const userId = request.header('x-user-id')?.trim();

    if (!userId) {
      throw new BadRequestException('Missing x-user-id header');
    }

    return {
      userId,
      isPremium: parseBooleanHeader(request.header('x-user-premium')),
    };
  },
);
