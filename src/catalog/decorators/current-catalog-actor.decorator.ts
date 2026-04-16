import {
  UnauthorizedException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import { CatalogActor } from '../interfaces/catalog-actor.interface';
import { RequestWithAuthenticatedUser } from '../../auth/interfaces/authenticated-request.interface';

export function resolveCatalogActorFromRequest(
  request: RequestWithAuthenticatedUser,
): CatalogActor | null {
  return request.catalogActor ?? null;
}

export const CurrentCatalogActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CatalogActor => {
    const request =
      context.switchToHttp().getRequest<RequestWithAuthenticatedUser>();
    const actor = resolveCatalogActorFromRequest(request);

    if (!actor) {
      throw new UnauthorizedException('Missing authenticated actor');
    }

    return actor;
  },
);
