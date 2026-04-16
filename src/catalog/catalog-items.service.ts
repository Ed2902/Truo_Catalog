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
import { sanitizePlainText } from '../common/utils/sanitize-text.util';
import {
  CatalogItemPublicationStatus,
} from './catalog.constants';
import { CatalogCategoriesService } from './catalog-categories.service';
import { CatalogDuplicatePolicyService } from './catalog-duplicate-policy.service';
import { CatalogNegotiationPolicyService } from './catalog-negotiation-policy.service';
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
    private readonly negotiationPolicyService: CatalogNegotiationPolicyService,
  ) {}

  async createItem(actor: CatalogActor, createCatalogItemDto: CreateCatalogItemDto) {
    const sanitizedPayload = this.sanitizeItemInput(createCatalogItemDto);

    await this.categoriesService.getCategoryOrThrow(sanitizedPayload.categoryId);
    await this.duplicatePolicyService.assertNoDuplicateFreeItem(
      actor,
      sanitizedPayload,
    );

    const images = this.normalizeImages(sanitizedPayload.images);
    const publicationStatus =
      sanitizedPayload.publicationStatus ??
      CatalogItemPublicationStatus.DRAFT;
    const shouldPublish = publicationStatus === CatalogItemPublicationStatus.ACTIVE;
    const item = await this.prismaService.catalogItem.create({
      data: {
        ownerUserId: actor.userId,
        title: sanitizedPayload.title,
        normalizedTitle: normalizeCatalogText(sanitizedPayload.title),
        titleTokenSignature: buildTitleTokenSignature(
          sanitizedPayload.title,
        ),
        slug: await this.generateUniqueSlug(sanitizedPayload.title),
        description: sanitizedPayload.description,
        normalizedDescription: normalizeCatalogText(
          sanitizedPayload.description,
        ),
        categoryId: sanitizedPayload.categoryId,
        condition: sanitizedPayload.condition as never,
        subjectiveValue: sanitizedPayload.subjectiveValue,
        exchangePreferences: sanitizedPayload.exchangePreferences ?? null,
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

    const sanitizedUpdate = this.sanitizeItemInput(updateCatalogItemDto);

    const nextState = {
      title: sanitizedUpdate.title ?? existingItem.title,
      description: sanitizedUpdate.description ?? existingItem.description,
      categoryId: sanitizedUpdate.categoryId ?? existingItem.categoryId,
      condition: sanitizedUpdate.condition ?? existingItem.condition,
      images:
        sanitizedUpdate.images ??
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
      sanitizedUpdate.publicationStatus ?? existingItem.publicationStatus;
    const shouldPublish =
      !existingItem.publishedAt &&
      nextPublicationStatus === CatalogItemPublicationStatus.ACTIVE;
    const normalizedImages = sanitizedUpdate.images
      ? this.normalizeImages(sanitizedUpdate.images)
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
          ...(sanitizedUpdate.title !== undefined && {
            title: sanitizedUpdate.title,
            normalizedTitle: normalizeCatalogText(sanitizedUpdate.title),
            titleTokenSignature: buildTitleTokenSignature(
              sanitizedUpdate.title,
            ),
          }),
          ...(sanitizedUpdate.description !== undefined && {
            description: sanitizedUpdate.description,
            normalizedDescription: normalizeCatalogText(
              sanitizedUpdate.description,
            ),
          }),
          ...(sanitizedUpdate.categoryId !== undefined && {
            categoryId: sanitizedUpdate.categoryId,
          }),
          ...(sanitizedUpdate.condition !== undefined && {
            condition: sanitizedUpdate.condition as never,
          }),
          ...(sanitizedUpdate.subjectiveValue !== undefined && {
            subjectiveValue: sanitizedUpdate.subjectiveValue,
          }),
          ...(sanitizedUpdate.exchangePreferences !== undefined && {
            exchangePreferences: sanitizedUpdate.exchangePreferences || null,
          }),
          ...(sanitizedUpdate.publicationStatus !== undefined && {
            publicationStatus: sanitizedUpdate.publicationStatus as never,
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

  async deleteItem(actor: CatalogActor, itemId: string) {
    const existingItem = await this.prismaService.catalogItem.findUnique({
      where: {
        id: itemId,
      },
      select: {
        id: true,
        ownerUserId: true,
        deletedAt: true,
      },
    });

    if (!existingItem || existingItem.deletedAt) {
      throw new NotFoundException('Catalog item not found');
    }

    if (existingItem.ownerUserId !== actor.userId) {
      throw new ForbiddenException('You can only delete your own items');
    }

    await this.prismaService.catalogItem.update({
      where: {
        id: itemId,
      },
      data: {
        deletedAt: new Date(),
        publicationStatus: CatalogItemPublicationStatus.INACTIVE as never,
      },
    });

    return {
      success: true,
      itemId,
    };
  }

  async listMyItems(actor: CatalogActor, query: ListCatalogItemsQueryDto) {
    const items = await this.prismaService.catalogItem.findMany({
      where: {
        ownerUserId: actor.userId,
        deletedAt: null,
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...this.buildPublicationStatusFilter(query.publicationStatus),
        ...this.buildSearchFilter(query.search),
      },
      include: itemDetailInclude,
      orderBy: [{ createdAt: 'desc' }],
      take: query.take ?? 20,
    });

    return Promise.all(items.map((item) => this.serializeItem(item)));
  }

  async listPublicItems(query: ListCatalogItemsQueryDto) {
    const publicationStatus = query.publicationStatus;
    const items = await this.prismaService.catalogItem.findMany({
      where: {
        deletedAt: null,
        ...this.buildPublicationStatusFilter(publicationStatus),
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

    if (
      !isOwner &&
      ![
        CatalogItemPublicationStatus.ACTIVE,
        CatalogItemPublicationStatus.IN_NEGOTIATION,
      ].includes(item.publicationStatus as CatalogItemPublicationStatus)
    ) {
      throw new NotFoundException('Catalog item not found');
    }

    return this.serializeItem(item);
  }

  async getOwnedActiveItemOrThrow(actor: CatalogActor, itemId: string) {
    const item = await this.getOwnedItemOrThrow(actor, itemId);

    if (
      ![
        CatalogItemPublicationStatus.ACTIVE,
        CatalogItemPublicationStatus.IN_NEGOTIATION,
      ].includes(item.publicationStatus as CatalogItemPublicationStatus)
    ) {
      throw new BadRequestException('Only active items can be offered');
    }

    return item;
  }

  async getOwnedItemOrThrow(actor: CatalogActor, itemId: string) {
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

    if (
      ![
        CatalogItemPublicationStatus.ACTIVE,
        CatalogItemPublicationStatus.IN_NEGOTIATION,
      ].includes(item.publicationStatus as CatalogItemPublicationStatus)
    ) {
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

    const activeNegotiationsCount =
      await this.negotiationPolicyService.countActiveNegotiationsForItem(itemId);

    if (
      activeNegotiationsCount > 0 &&
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
      activeNegotiationsCount === 0 &&
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

  private buildPublicationStatusFilter(
    publicationStatus?: CatalogItemPublicationStatus,
  ) {
    if (!publicationStatus) {
      return {
        publicationStatus: {
          in: [
            CatalogItemPublicationStatus.ACTIVE,
            CatalogItemPublicationStatus.IN_NEGOTIATION,
          ] as never,
        },
      };
    }

    if (publicationStatus === CatalogItemPublicationStatus.ACTIVE) {
      return {
        publicationStatus: {
          in: [
            CatalogItemPublicationStatus.ACTIVE,
            CatalogItemPublicationStatus.IN_NEGOTIATION,
          ] as never,
        },
      };
    }

    return {
      publicationStatus: publicationStatus as never,
    };
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

  private sanitizeItemInput<
    T extends Partial<CreateCatalogItemDto | UpdateCatalogItemDto>,
  >(input: T): T {
    return {
      ...input,
      ...(input.title !== undefined && {
        title: sanitizePlainText(input.title),
      }),
      ...(input.description !== undefined && {
        description: sanitizePlainText(input.description, {
          preserveNewLines: true,
        }),
      }),
      ...(input.exchangePreferences !== undefined && {
        exchangePreferences: sanitizePlainText(input.exchangePreferences, {
          preserveNewLines: true,
        }),
      }),
    };
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
    const activeNegotiationsCount =
      await this.negotiationPolicyService.countActiveNegotiationsForItem(item.id);

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
