import { Request } from 'express';

export interface CatalogActor {
  userId: string;
  isPremium: boolean;
}

export interface CatalogRequest extends Request {
  user?: CatalogActor;
}
