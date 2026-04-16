import { Request } from 'express';
import { CatalogActor } from '../../catalog/interfaces/catalog-actor.interface';

export interface AuthenticatedRequestUser {
  userId: string;
  sessionId: string;
  email?: string;
  tokenType: 'access';
}

export interface RequestWithAuthenticatedUser extends Request {
  user?: AuthenticatedRequestUser;
  catalogActor?: CatalogActor;
}
