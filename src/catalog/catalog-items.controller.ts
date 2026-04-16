import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CatalogItemsService } from './catalog-items.service';
import { CurrentCatalogActor } from './decorators/current-catalog-actor.decorator';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto';
import { ListCatalogItemsQueryDto } from './dto/list-catalog-items-query.dto';
import { UpdateCatalogItemDto } from './dto/update-catalog-item.dto';
import { CatalogActor } from './interfaces/catalog-actor.interface';

@Controller('catalog/items')
export class CatalogItemsController {
  constructor(private readonly catalogItemsService: CatalogItemsService) {}

  @Post()
  createItem(
    @CurrentCatalogActor() actor: CatalogActor,
    @Body() createCatalogItemDto: CreateCatalogItemDto,
  ) {
    return this.catalogItemsService.createItem(actor, createCatalogItemDto);
  }

  @Patch(':itemId')
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

  @Get('me')
  listMyItems(
    @CurrentCatalogActor() actor: CatalogActor,
    @Query() query: ListCatalogItemsQueryDto,
  ) {
    return this.catalogItemsService.listMyItems(actor, query);
  }

  @Get()
  listPublicItems(@Query() query: ListCatalogItemsQueryDto) {
    return this.catalogItemsService.listPublicItems(query);
  }

  @Get(':itemId')
  getItemDetail(
    @Param('itemId') itemId: string,
    @CurrentCatalogActor() actor?: CatalogActor,
  ) {
    return this.catalogItemsService.getItemDetail(itemId, actor);
  }
}
