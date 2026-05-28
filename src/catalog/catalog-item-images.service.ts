import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CatalogActor } from './interfaces/catalog-actor.interface';
import { ConfirmCatalogItemImageUploadDto } from './dto/confirm-catalog-item-image-upload.dto';
import { CreateCatalogItemImageUploadUrlDto } from './dto/create-catalog-item-image-upload-url.dto';
import { CatalogItemsService } from './catalog-items.service';

const MAX_IMAGES_PER_ITEM = 5;

@Injectable()
export class CatalogItemImagesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
    private readonly catalogItemsService: CatalogItemsService,
  ) {}

  async createUploadUrl(
    actor: CatalogActor,
    itemId: string,
    createUploadUrlDto: CreateCatalogItemImageUploadUrlDto,
  ) {
    await this.catalogItemsService.getOwnedItemOrThrow(actor, itemId);
    await this.assertCanAttachAnotherImage(itemId);

    return this.storageService.createCatalogItemImageUploadUrl({
      userId: actor.userId,
      itemId,
      fileName: createUploadUrlDto.fileName,
      mimeType: createUploadUrlDto.mimeType,
      size: createUploadUrlDto.size,
    });
  }

  async confirmUpload(
    actor: CatalogActor,
    itemId: string,
    confirmUploadDto: ConfirmCatalogItemImageUploadDto,
  ) {
    await this.catalogItemsService.getOwnedItemOrThrow(actor, itemId);
    await this.assertCanAttachAnotherImage(itemId);
    this.storageService.assertCatalogItemImageOwnership(
      actor.userId,
      itemId,
      confirmUploadDto.storageKey,
    );
    await this.storageService.ensureObjectExists(confirmUploadDto.storageKey);

    const existingImage = await this.prismaService.catalogItemImage.findFirst({
      where: {
        catalogItemId: itemId,
        storagePath: confirmUploadDto.storageKey,
      },
      select: {
        id: true,
      },
    });

    if (existingImage) {
      throw new ConflictException('Image is already attached to this item');
    }

    const existingImageCount = await this.prismaService.catalogItemImage.count({
      where: {
        catalogItemId: itemId,
      },
    });
    const nextSortOrder = confirmUploadDto.sortOrder ?? existingImageCount;
    const shouldBeCover = await this.resolveCoverFlag(
      itemId,
      Boolean(confirmUploadDto.isCover),
    );

    const image = await this.prismaService.$transaction(async (tx) => {
      if (shouldBeCover) {
        await tx.catalogItemImage.updateMany({
          where: {
            catalogItemId: itemId,
            isCover: true,
          },
          data: {
            isCover: false,
          },
        });
      }

      return tx.catalogItemImage.create({
        data: {
          catalogItemId: itemId,
          storagePath: confirmUploadDto.storageKey,
          storageUrl: this.storageService.createCatalogItemImagePublicUrl(
            confirmUploadDto.storageKey,
          ),
          sortOrder: nextSortOrder,
          isCover: shouldBeCover,
        },
      });
    });

    return {
      id: image.id,
      catalogItemId: image.catalogItemId,
      storageUrl: image.storageUrl,
      storagePath: image.storagePath,
      sortOrder: image.sortOrder,
      isCover: image.isCover,
      createdAt: image.createdAt,
      compression: {
        mode: 'lossless-preferred',
        applied: false,
        reason:
          'Direct-to-storage upload is enabled. Binary recompression is reserved for a post-upload processor to avoid accidental quality loss.',
      },
    };
  }

  private async assertCanAttachAnotherImage(itemId: string) {
    const currentCount = await this.prismaService.catalogItemImage.count({
      where: {
        catalogItemId: itemId,
      },
    });

    if (currentCount >= MAX_IMAGES_PER_ITEM) {
      throw new BadRequestException(
        `Catalog items support a maximum of ${MAX_IMAGES_PER_ITEM} images`,
      );
    }
  }

  private async resolveCoverFlag(itemId: string, requestedCover: boolean) {
    if (requestedCover) {
      return true;
    }

    const existingCover = await this.prismaService.catalogItemImage.findFirst({
      where: {
        catalogItemId: itemId,
        isCover: true,
      },
      select: {
        id: true,
      },
    });

    return !existingCover;
  }
}
