import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SensitiveRateLimit } from '../common/decorators/sensitive-rate-limit.decorator';
import { CatalogItemImagesService } from './catalog-item-images.service';
import { CurrentCatalogActor } from './decorators/current-catalog-actor.decorator';
import { ConfirmCatalogItemImageUploadDto } from './dto/confirm-catalog-item-image-upload.dto';
import { CreateCatalogItemImageUploadUrlDto } from './dto/create-catalog-item-image-upload-url.dto';
import { CatalogActor } from './interfaces/catalog-actor.interface';

@Controller('catalog/items/:itemId/images')
@UseGuards(JwtAuthGuard)
export class CatalogItemImagesController {
  constructor(
    private readonly catalogItemImagesService: CatalogItemImagesService,
  ) {}

  @Post('upload-url')
  @SensitiveRateLimit()
  createUploadUrl(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('itemId') itemId: string,
    @Body() createUploadUrlDto: CreateCatalogItemImageUploadUrlDto,
  ) {
    return this.catalogItemImagesService.createUploadUrl(
      actor,
      itemId,
      createUploadUrlDto,
    );
  }

  @Post('confirm')
  @SensitiveRateLimit()
  confirmUpload(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('itemId') itemId: string,
    @Body() confirmUploadDto: ConfirmCatalogItemImageUploadDto,
  ) {
    return this.catalogItemImagesService.confirmUpload(
      actor,
      itemId,
      confirmUploadDto,
    );
  }
}
