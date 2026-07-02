import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { DetailRateLimit } from '../../common/decorators/detail-rate-limit.decorator';
import { HomeRateLimit } from '../../common/decorators/home-rate-limit.decorator';
import { SensitiveRateLimit } from '../../common/decorators/sensitive-rate-limit.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { RequestWithAuthenticatedUser } from '../../auth/interfaces/authenticated-request.interface';
import { CatalogItemsService } from './catalog-items.service';
import {
  CurrentCatalogActor,
  resolveCatalogActorFromRequest,
} from '../decorators/current-catalog-actor.decorator';
import { CreateCatalogItemDto } from '../dto/create-catalog-item.dto';
import { ListCatalogItemsQueryDto } from '../dto/list-catalog-items-query.dto';
import { UpdateCatalogItemDto } from '../dto/update-catalog-item.dto';
import { CatalogActor } from '../interfaces/catalog-actor.interface';

@Controller('catalog/items')
export class CatalogItemsController {
  constructor(private readonly catalogItemsService: CatalogItemsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @SensitiveRateLimit()
  createItem(
    @CurrentCatalogActor() actor: CatalogActor,
    @Body() createCatalogItemDto: CreateCatalogItemDto,
  ) {
    return this.catalogItemsService.createItem(actor, createCatalogItemDto);
  }

  @Patch(':itemId')
  @UseGuards(JwtAuthGuard)
  @SensitiveRateLimit()
  updateItem(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('itemId') itemId: string,
    @Body() updateCatalogItemDto: UpdateCatalogItemDto,
  ) {
    return this.catalogItemsService.updateItem(
      actor,
      itemId,
      updateCatalogItemDto,
    );
  }

  @Delete(':itemId')
  @UseGuards(JwtAuthGuard)
  @SensitiveRateLimit()
  deleteItem(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('itemId') itemId: string,
  ) {
    return this.catalogItemsService.deleteItem(actor, itemId);
  }

  @Post(':itemId/restore')
  @UseGuards(JwtAuthGuard)
  @SensitiveRateLimit()
  restoreItem(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('itemId') itemId: string,
  ) {
    return this.catalogItemsService.restoreItem(actor, itemId);
  }

  @Get('me/trash')
  @UseGuards(JwtAuthGuard)
  listTrash(
    @CurrentCatalogActor() actor: CatalogActor,
    @Query() query: ListCatalogItemsQueryDto,
  ) {
    return this.catalogItemsService.listTrash(actor, query);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  listMyItems(
    @CurrentCatalogActor() actor: CatalogActor,
    @Query() query: ListCatalogItemsQueryDto,
  ) {
    return this.catalogItemsService.listMyItems(actor, query);
  }

  @Get('home-feed')
  @UseGuards(OptionalJwtAuthGuard)
  @HomeRateLimit()
  getHomeFeed(
    @Query() query: ListCatalogItemsQueryDto,
    @Req() request: Request,
  ) {
    return this.catalogItemsService.getHomeFeed(
      query,
      resolveCatalogActorFromRequest(
        request as RequestWithAuthenticatedUser,
      ) ?? undefined,
    );
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  listPublicItems(
    @Query() query: ListCatalogItemsQueryDto,
    @Req() request: Request,
  ) {
    return this.catalogItemsService.listPublicItems(
      query,
      resolveCatalogActorFromRequest(
        request as RequestWithAuthenticatedUser,
      ) ?? undefined,
    );
  }

  @Get(':itemId')
  @UseGuards(OptionalJwtAuthGuard)
  @DetailRateLimit()
  getItemDetail(
    @Param('itemId') itemId: string,
    @Req() request: Request,
  ) {
    return this.catalogItemsService.getItemDetail(
      itemId,
      resolveCatalogActorFromRequest(request) ?? undefined,
    );
  }
}
