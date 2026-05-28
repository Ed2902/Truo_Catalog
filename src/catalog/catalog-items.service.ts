import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CatalogCategory,
  CatalogItemImage,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CatalogItemPublicationStatus,
  ExchangeProposalStatus,
} from './catalog.constants';
import { CatalogCategoriesService } from './catalog-categories.service';
import { CatalogDuplicatePolicyService } from './catalog-duplicate-policy.service';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto';
import { ListCatalogItemsQueryDto } from './dto/list-catalog-items-query.dto';
import { UpdateCatalogItemDto } from './dto/update-catalog-item.dto';
import { CatalogActor } from './interfaces/catalog-actor.interface';
import {
  buildTitleTokenSignature,
  normalizeCatalogText,
  slugifyCatalogTitle,
} from './utils/catalog-normalization.util';

const itemDetailInclude = {
  category: true,
  images: {
    orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.CatalogItemInclude;

type CatalogItemWithRelations = Prisma.CatalogItemGetPayload<{
  include: typeof itemDetailInclude;
}>;

@Injectable()
export class CatalogItemsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly categoriesService: CatalogCategoriesService,
    private readonly duplicatePolicyService: CatalogDuplicatePolicyService,
  ) {}

  async createItem(actor: CatalogActor, createCatalogItemDto: CreateCatalogItemDto) {
    await this.categoriesService.getCategoryOrThrow(createCatalogItemDto.categoryId);
    await this.duplicatePolicyService.assertNoDuplicateFreeItem(
      actor,
      createCatalogItemDto,
    );

    const images = this.normalizeImages(createCatalogItemDto.images);
    const publicationStatus =
      createCatalogItemDto.publicationStatus ??
      CatalogItemPublicationStatus.DRAFT;
    const shouldPublish = publicationStatus === CatalogItemPublicationStatus.ACTIVE;
    const item = await this.prismaService.catalogItem.create({
      data: {
        ownerUserId: actor.userId,
        title: createCatalogItemDto.title.trim(),
        normalizedTitle: normalizeCatalogText(createCatalogItemDto.title),
        titleTokenSignature: buildTitleTokenSignature(
          createCatalogItemDto.title,
        ),
        slug: await this.generateUniqueSlug(createCatalogItemDto.title),
        description: createCatalogItemDto.description.trim(),
        normalizedDescription: normalizeCatalogText(
          createCatalogItemDto.description,
        ),
        categoryId: createCatalogItemDto.categoryId,
        condition: createCatalogItemDto.condition as never,
        subjectiveValue: createCatalogItemDto.subjectiveValue,
        exchangePreferences:
          createCatalogItemDto.exchangePreferences?.trim() ?? null,
        publicationStatus: publicationStatus as never,
        publishedAt: shouldPublish ? new Date() : null,
        images: images.length
          ? {
              create: images.map((image) => ({
                storageUrl: image.storageUrl,
                storagePath: image.storagePath ?? null,
                sortOrder: image.sortOrder,
                isCover: image.isCover,
              })),
            }
          : undefined,
      },
      include: itemDetailInclude,
    });

    return this.serializeItem(item);
  }

  async updateItem(
    actor: CatalogActor,
    itemId: string,
    updateCatalogItemDto: UpdateCatalogItemDto,
  ) {
    const existingItem = await this.prismaService.catalogItem.findUnique({
      where: {
        id: itemId,
      },
      include: itemDetailInclude,
    });

    if (!existingItem || existingItem.deletedAt) {
      throw new NotFoundException('Catalog item not found');
    }

    if (existingItem.ownerUserId !== actor.userId) {
      throw new ForbiddenException('You can only edit your own items');
    }

    const nextState = {
      title: updateCatalogItemDto.title ?? existingItem.title,
      description: updateCatalogItemDto.description ?? existingItem.description,
      categoryId: updateCatalogItemDto.categoryId ?? existingItem.categoryId,
      condition: updateCatalogItemDto.condition ?? existingItem.condition,
      images:
        updateCatalogItemDto.images ??
        existingItem.images.map((image) => ({
          storageUrl: image.storageUrl,
          storagePath: image.storagePath ?? undefined,
          sortOrder: image.sortOrder,
          isCover: image.isCover,
        })),
    };

    await this.categoriesService.getCategoryOrThrow(nextState.categoryId);
    await this.duplicatePolicyService.assertNoDuplicateFreeItem(
      actor,
      nextState,
      itemId,
    );

    const nextPublicationStatus =
      updateCatalogItemDto.publicationStatus ?? existingItem.publicationStatus;
    const shouldPublish =
      !existingItem.publishedAt &&
      nextPublicationStatus === CatalogItemPublicationStatus.ACTIVE;
    const normalizedImages = updateCatalogItemDto.images
      ? this.normalizeImages(updateCatalogItemDto.images)
      : null;

    const item = await this.prismaService.$transaction(async (tx) => {
      if (normalizedImages) {
        await tx.catalogItemImage.deleteMany({
          where: {
            catalogItemId: itemId,
          },
        });
      }

      return tx.catalogItem.update({
        where: {
          id: itemId,
        },
        data: {
          ...(updateCatalogItemDto.title !== undefined && {
            title: updateCatalogItemDto.title.trim(),
            normalizedTitle: normalizeCatalogText(updateCatalogItemDto.title),
            titleTokenSignature: buildTitleTokenSignature(
              updateCatalogItemDto.title,
            ),
          }),
          ...(updateCatalogItemDto.description !== undefined && {
            description: updateCatalogItemDto.description.trim(),
            normalizedDescription: normalizeCatalogText(
              updateCatalogItemDto.description,
            ),
          }),
          ...(updateCatalogItemDto.categoryId !== undefined && {
            categoryId: updateCatalogItemDto.categoryId,
          }),
          ...(updateCatalogItemDto.condition !== undefined && {
            condition: updateCatalogItemDto.condition as never,
          }),
          ...(updateCatalogItemDto.subjectiveValue !== undefined && {
            subjectiveValue: updateCatalogItemDto.subjectiveValue,
          }),
          ...(updateCatalogItemDto.exchangePreferences !== undefined && {
            exchangePreferences:
              updateCatalogItemDto.exchangePreferences?.trim() || null,
          }),
          ...(updateCatalogItemDto.publicationStatus !== undefined && {
            publicationStatus: updateCatalogItemDto.publicationStatus as never,
          }),
          ...(shouldPublish && {
            publishedAt: new Date(),
          }),
          ...(normalizedImages && {
            images: {
              create: normalizedImages.map((image) => ({
                storageUrl: image.storageUrl,
                storagePath: image.storagePath ?? null,
                sortOrder: image.sortOrder,
                isCover: image.isCover,
              })),
            },
          }),
        },
        include: itemDetailInclude,
      });
    });

    return this.serializeItem(item);
  }

  async listMyItems(actor: CatalogActor, query: ListCatalogItemsQueryDto) {
    const items = await this.prismaService.catalogItem.findMany({
      where: {
        ownerUserId: actor.userId,
        deletedAt: null,
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.publicationStatus
          ? { publicationStatus: query.publicationStatus as never }
          : {}),
        ...this.buildSearchFilter(query.search),
      },
      include: itemDetailInclude,
      orderBy: [{ createdAt: 'desc' }],
      take: query.take ?? 20,
    });

    return Promise.all(items.map((item) => this.serializeItem(item)));
  }

  async listPublicItems(query: ListCatalogItemsQueryDto) {
    const publicationStatus =
      query.publicationStatus ?? CatalogItemPublicationStatus.ACTIVE;
    const items = await this.prismaService.catalogItem.findMany({
      where: {
        deletedAt: null,
        publicationStatus: publicationStatus as never,
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.ownerUserId ? { ownerUserId: query.ownerUserId } : {}),
        ...this.buildSearchFilter(query.search),
      },
      include: itemDetailInclude,
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: query.take ?? 20,
    });

    return Promise.all(items.map((item) => this.serializeItem(item)));
  }

  async getItemDetail(itemId: string, actor?: CatalogActor) {
    const item = await this.prismaService.catalogItem.findUnique({
      where: {
        id: itemId,
      },
      include: itemDetailInclude,
    });

    if (!item || item.deletedAt) {
      throw new NotFoundException('Catalog item not found');
    }

    const isOwner = actor?.userId === item.ownerUserId;

    if (!isOwner && item.publicationStatus !== CatalogItemPublicationStatus.ACTIVE) {
      throw new NotFoundException('Catalog item not found');
    }

    return this.serializeItem(item);
  }

  async getOwnedActiveItemOrThrow(actor: CatalogActor, itemId: string) {
    const item = await this.prismaService.catalogItem.findUnique({
      where: {
        id: itemId,
      },
    });

    if (!item || item.deletedAt) {
      throw new NotFoundException('Catalog item not found');
    }

    if (item.ownerUserId !== actor.userId) {
      throw new ForbiddenException('You can only use your own item');
    }

    if (item.publicationStatus !== CatalogItemPublicationStatus.ACTIVE) {
      throw new BadRequestException('Only active items can be offered');
    }

    return item;
  }

  async getPublicNegotiableItemOrThrow(itemId: string) {
    const item = await this.prismaService.catalogItem.findUnique({
      where: {
        id: itemId,
      },
    });

    if (!item || item.deletedAt) {
      throw new NotFoundException('Catalog item not found');
    }

    if (item.publicationStatus !== CatalogItemPublicationStatus.ACTIVE) {
      throw new BadRequestException('Requested item is not available');
    }

    return item;
  }

  async syncNegotiationStatus(itemId: string) {
    const item = await this.prismaService.catalogItem.findUnique({
      where: {
        id: itemId,
      },
      select: {
        id: true,
        publicationStatus: true,
        deletedAt: true,
      },
    });

    if (!item || item.deletedAt) {
      return;
    }

    const acceptedProposalCount = await this.prismaService.exchangeProposal.count({
      where: {
        status: ExchangeProposalStatus.ACCEPTED as never,
        OR: [{ requestedItemId: itemId }, { offeredItemId: itemId }],
      },
    });

    if (
      acceptedProposalCount > 0 &&
      item.publicationStatus === CatalogItemPublicationStatus.ACTIVE
    ) {
      await this.prismaService.catalogItem.update({
        where: {
          id: itemId,
        },
        data: {
          publicationStatus: CatalogItemPublicationStatus.IN_NEGOTIATION as never,
        },
      });
      return;
    }

    if (
      acceptedProposalCount === 0 &&
      item.publicationStatus === CatalogItemPublicationStatus.IN_NEGOTIATION
    ) {
      await this.prismaService.catalogItem.update({
        where: {
          id: itemId,
        },
        data: {
          publicationStatus: CatalogItemPublicationStatus.ACTIVE as never,
        },
      });
    }
  }

  private async generateUniqueSlug(title: string) {
    const base = slugifyCatalogTitle(title);

    if (!base) {
      throw new BadRequestException('Title is invalid');
    }

    const existingCount = await this.prismaService.catalogItem.count({
      where: {
        slug: {
          startsWith: base,
        },
      },
    });

    return existingCount === 0 ? base : `${base}-${existingCount + 1}`;
  }

  private normalizeImages(
    images?: CreateCatalogItemDto['images'] | UpdateCatalogItemDto['images'],
  ) {
    const normalized = (images ?? []).map((image, index) => ({
      storageUrl: image.storageUrl,
      storagePath: image.storagePath?.trim() || undefined,
      sortOrder: image.sortOrder ?? index,
      isCover: Boolean(image.isCover),
    }));

    if (!normalized.length) {
      return normalized;
    }

    const firstCoverIndex = normalized.findIndex((image) => image.isCover);

    if (firstCoverIndex === -1) {
      normalized[0].isCover = true;
    }

    if (firstCoverIndex > -1) {
      normalized.forEach((image, index) => {
        image.isCover = index === firstCoverIndex;
      });
    }

    return normalized.sort((left, right) => left.sortOrder - right.sortOrder);
  }

  private buildSearchFilter(search?: string) {
    if (!search) {
      return {};
    }

    return {
      OR: [
        {
          title: {
            contains: search,
            mode: 'insensitive' as const,
          },
        },
        {
          description: {
            contains: search,
            mode: 'insensitive' as const,
          },
        },
      ],
    };
  }

  private async serializeItem(item: CatalogItemWithRelations) {
    const activeNegotiationsCount = await this.prismaService.exchangeProposal.count({
      where: {
        status: {
          in: [
            ExchangeProposalStatus.PENDING,
            ExchangeProposalStatus.ACCEPTED,
          ] as never,
        },
        OR: [{ requestedItemId: item.id }, { offeredItemId: item.id }],
      },
    });

    return {
      id: item.id,
      ownerUserId: item.ownerUserId,
      title: item.title,
      slug: item.slug,
      description: item.description,
      category: this.serializeCategory(item.category),
      condition: item.condition,
      subjectiveValue: item.subjectiveValue,
      exchangePreferences: item.exchangePreferences,
      publicationStatus: item.publicationStatus,
      publishedAt: item.publishedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      deletedAt: item.deletedAt,
      activeNegotiationsCount,
      images: item.images.map((image) => this.serializeImage(image)),
    };
  }

  private serializeCategory(category: CatalogCategory) {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      parentId: category.parentId,
      path: category.path,
      depth: category.depth,
    };
  }

  private serializeImage(image: CatalogItemImage) {
    return {
      id: image.id,
      storageUrl: image.storageUrl,
      storagePath: image.storagePath,
      sortOrder: image.sortOrder,
      isCover: image.isCover,
      createdAt: image.createdAt,
    };
  }
}
