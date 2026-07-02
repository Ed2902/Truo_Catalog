import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { HomeRateLimit } from '../../common/decorators/home-rate-limit.decorator';
import { RequestWithAuthenticatedUser } from '../../auth/interfaces/authenticated-request.interface';
import {
  resolveCatalogActorFromRequest,
} from '../decorators/current-catalog-actor.decorator';
import { ListCatalogItemsQueryDto } from '../dto/list-catalog-items-query.dto';
import { CatalogHomeService } from './catalog-home.service';

@Controller('catalog/home')
export class CatalogHomeController {
  constructor(private readonly catalogHomeService: CatalogHomeService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @HomeRateLimit()
  getHome(
    @Query() query: ListCatalogItemsQueryDto,
    @Req() request: Request,
  ) {
    return this.catalogHomeService.getHomeSnapshot({
      query,
      actor:
        resolveCatalogActorFromRequest(
          request as RequestWithAuthenticatedUser,
        ) ?? undefined,
      authorization: request.header('authorization') ?? undefined,
    });
  }
}
