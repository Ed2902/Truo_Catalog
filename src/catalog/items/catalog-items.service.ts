import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { CatalogCategory, CatalogItemImage, Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { StorageService } from '../../storage/storage.service'
import { sanitizePlainText } from '../../common/utils/sanitize-text.util'
import { CatalogItemPublicationStatus } from '../shared/catalog.constants'
import { CatalogCategoriesService } from '../categories/catalog-categories.service'
import { CatalogDuplicatePolicyService } from './catalog-duplicate-policy.service'
import { CatalogNegotiationPolicyService } from '../exchanges/catalog-negotiation-policy.service'
import { IdentitySignalsService } from '../identity/identity-signals.service'
import { CatalogPublicationModerationService } from '../moderation/catalog-publication-moderation.service'
import { CreateCatalogItemDto } from '../dto/create-catalog-item.dto'
import { ListCatalogItemsQueryDto } from '../dto/list-catalog-items-query.dto'
import { UpdateCatalogItemDto } from '../dto/update-catalog-item.dto'
import { CatalogActor } from '../interfaces/catalog-actor.interface'
import {
  buildTitleTokenSignature,
  normalizeCatalogText,
  slugifyCatalogTitle,
} from '../utils/catalog-normalization.util'

const itemDetailInclude = {
  category: true,
  images: {
    orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.CatalogItemInclude

type CatalogItemWithRelations = Prisma.CatalogItemGetPayload<{
  include: typeof itemDetailInclude
}>

const TRASH_RECOVERY_DAYS = 5

type CatalogOwnerRankingSignals = {
  ownerIsPremium: boolean
  ownerAverageRating: number | null
  ownerRatingCount: number
  score: number
}

@Injectable()
export class CatalogItemsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly storageService: StorageService,
    private readonly categoriesService: CatalogCategoriesService,
    private readonly duplicatePolicyService: CatalogDuplicatePolicyService,
    private readonly negotiationPolicyService: CatalogNegotiationPolicyService,
    private readonly identitySignalsService: IdentitySignalsService,
    private readonly catalogPublicationModerationService: CatalogPublicationModerationService
  ) {}

  async createItem(
    actor: CatalogActor,
    createCatalogItemDto: CreateCatalogItemDto
  ) {
    const sanitizedPayload = this.sanitizeItemInput(createCatalogItemDto)

    await this.categoriesService.getCategoryOrThrow(sanitizedPayload.categoryId)
    await this.duplicatePolicyService.assertNoDuplicateFreeItem(
      actor,
      sanitizedPayload
    )

    const images = this.normalizeImages(sanitizedPayload.images)
    const requestedPublicationStatus =
      sanitizedPayload.publicationStatus ?? CatalogItemPublicationStatus.DRAFT
    const shouldQueuePublicationReview =
      requestedPublicationStatus === CatalogItemPublicationStatus.ACTIVE
    const publicationStatus = shouldQueuePublicationReview
      ? CatalogItemPublicationStatus.UNDER_REVIEW
      : requestedPublicationStatus
    const shouldPublish = this.shouldSetPublishedAt(
      publicationStatus,
      shouldQueuePublicationReview
    )
    let item = await this.prismaService.catalogItem.create({
      data: {
        ownerUserId: actor.userId,
        title: sanitizedPayload.title,
        normalizedTitle: normalizeCatalogText(sanitizedPayload.title),
        titleTokenSignature: buildTitleTokenSignature(sanitizedPayload.title),
        slug: await this.generateUniqueSlug(sanitizedPayload.title),
        description: sanitizedPayload.description,
        normalizedDescription: normalizeCatalogText(
          sanitizedPayload.description
        ),
        categoryId: sanitizedPayload.categoryId,
        condition: sanitizedPayload.condition as never,
        subjectiveValue: sanitizedPayload.subjectiveValue,
        exchangePreferences: sanitizedPayload.exchangePreferences ?? null,
        publicationStatus: publicationStatus as never,
        publishedAt: shouldPublish ? new Date() : null,
        images: images.length
          ? {
              create: images.map(image => ({
                storageUrl: image.storageUrl,
                storagePath: image.storagePath ?? null,
                sortOrder: image.sortOrder,
                isCover: image.isCover,
              })),
            }
          : undefined,
      },
      include: itemDetailInclude,
    })

    if (shouldQueuePublicationReview) {
      await this.catalogPublicationModerationService.queuePublicationReview(
        item.id
      )
      item = await this.getItemWithRelationsOrThrow(item.id)
    }

    return this.serializeItem(item, { includeOwnerModerationReport: true })
  }

  async updateItem(
    actor: CatalogActor,
    itemId: string,
    updateCatalogItemDto: UpdateCatalogItemDto
  ) {
    const existingItem = await this.prismaService.catalogItem.findUnique({
      where: {
        id: itemId,
      },
      include: itemDetailInclude,
    })

    if (!existingItem || existingItem.deletedAt) {
      throw new NotFoundException('Catalog item not found')
    }

    if (existingItem.ownerUserId !== actor.userId) {
      throw new ForbiddenException('You can only edit your own items')
    }

    const sanitizedUpdate = this.sanitizeItemInput(updateCatalogItemDto)

    const nextState = {
      title: sanitizedUpdate.title ?? existingItem.title,
      description: sanitizedUpdate.description ?? existingItem.description,
      categoryId: sanitizedUpdate.categoryId ?? existingItem.categoryId,
      condition: sanitizedUpdate.condition ?? existingItem.condition,
      images:
        sanitizedUpdate.images ??
        existingItem.images.map(image => ({
          storageUrl: image.storageUrl,
          storagePath: image.storagePath ?? undefined,
          sortOrder: image.sortOrder,
          isCover: image.isCover,
        })),
    }

    await this.categoriesService.getCategoryOrThrow(nextState.categoryId)
    await this.duplicatePolicyService.assertNoDuplicateFreeItem(
      actor,
      nextState,
      itemId
    )

    const nextPublicationStatus =
      sanitizedUpdate.publicationStatus ?? existingItem.publicationStatus
    const normalizedImages = sanitizedUpdate.images
      ? this.normalizeImages(sanitizedUpdate.images)
      : null
    const hasModeratableContentChange = this.hasModeratableContentChange(
      sanitizedUpdate
    )
    const shouldQueuePublicationReview =
      nextPublicationStatus === CatalogItemPublicationStatus.ACTIVE ||
      (hasModeratableContentChange &&
        this.isReviewCyclePublicationStatus(existingItem.publicationStatus) &&
        this.isReviewCyclePublicationStatus(nextPublicationStatus))
    const targetPublicationStatus = shouldQueuePublicationReview
      ? CatalogItemPublicationStatus.UNDER_REVIEW
      : nextPublicationStatus
    const shouldPublish =
      !existingItem.publishedAt &&
      this.shouldSetPublishedAt(
        targetPublicationStatus,
        shouldQueuePublicationReview
      )

    let item = await this.prismaService.$transaction(async tx => {
      if (normalizedImages) {
        await tx.catalogItemImage.deleteMany({
          where: {
            catalogItemId: itemId,
          },
        })
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
              sanitizedUpdate.title
            ),
          }),
          ...(sanitizedUpdate.description !== undefined && {
            description: sanitizedUpdate.description,
            normalizedDescription: normalizeCatalogText(
              sanitizedUpdate.description
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
          ...((sanitizedUpdate.publicationStatus !== undefined ||
            shouldQueuePublicationReview) && {
            publicationStatus: targetPublicationStatus as never,
          }),
          ...(shouldPublish && {
            publishedAt: new Date(),
          }),
          ...(normalizedImages && {
            images: {
              create: normalizedImages.map(image => ({
                storageUrl: image.storageUrl,
                storagePath: image.storagePath ?? null,
                sortOrder: image.sortOrder,
                isCover: image.isCover,
              })),
            },
          }),
        },
        include: itemDetailInclude,
      })
    })

    if (shouldQueuePublicationReview) {
      await this.catalogPublicationModerationService.queuePublicationReview(
        item.id
      )
      item = await this.getItemWithRelationsOrThrow(item.id)
    }

    return this.serializeItem(item, { includeOwnerModerationReport: true })
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
        trashExpiresAt: true,
      },
    })

    if (!existingItem || existingItem.deletedAt) {
      throw new NotFoundException('Catalog item not found')
    }

    if (existingItem.ownerUserId !== actor.userId) {
      throw new ForbiddenException('You can only delete your own items')
    }

    const deletedAt = new Date()
    const trashExpiresAt = new Date(deletedAt)
    trashExpiresAt.setDate(trashExpiresAt.getDate() + TRASH_RECOVERY_DAYS)

    await this.prismaService.catalogItem.update({
      where: {
        id: itemId,
      },
      data: {
        deletedAt,
        trashExpiresAt,
        publicationStatus: CatalogItemPublicationStatus.INACTIVE as never,
      },
    })

    return {
      success: true,
      itemId,
      deletedAt,
      trashExpiresAt,
    }
  }

  async listTrash(actor: CatalogActor, query: ListCatalogItemsQueryDto) {
    const items = await this.prismaService.catalogItem.findMany({
      where: {
        ownerUserId: actor.userId,
        deletedAt: {
          not: null,
        },
        trashExpiresAt: {
          gt: new Date(),
        },
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...this.buildSearchFilter(query.search),
      },
      include: itemDetailInclude,
      orderBy: [{ deletedAt: 'desc' }],
      take: query.take ?? 20,
    })

    return Promise.all(
      items.map(item =>
        this.serializeItem(item, { includeOwnerModerationReport: true })
      )
    )
  }

  async restoreItem(actor: CatalogActor, itemId: string) {
    const existingItem = await this.prismaService.catalogItem.findUnique({
      where: {
        id: itemId,
      },
      include: itemDetailInclude,
    })

    if (!existingItem || existingItem.ownerUserId !== actor.userId) {
      throw new NotFoundException('Catalog item not found')
    }

    if (!existingItem.deletedAt || !existingItem.trashExpiresAt) {
      throw new BadRequestException('This item is not in trash')
    }

    if (existingItem.trashExpiresAt <= new Date()) {
      throw new BadRequestException('The restore window for this item expired')
    }

    let item = await this.prismaService.catalogItem.update({
      where: {
        id: itemId,
      },
      data: {
        deletedAt: null,
        trashExpiresAt: null,
        publicationStatus: CatalogItemPublicationStatus.UNDER_REVIEW as never,
      },
      include: itemDetailInclude,
    })

    await this.catalogPublicationModerationService.queuePublicationReview(
        item.id
    )
    item = await this.getItemWithRelationsOrThrow(item.id)

    return this.serializeItem(item, { includeOwnerModerationReport: true })
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
    })

    return Promise.all(
      items.map(item =>
        this.serializeItem(item, { includeOwnerModerationReport: true })
      )
    )
  }

  async listAdminItems(query: ListCatalogItemsQueryDto) {
    const items = await this.prismaService.catalogItem.findMany({
      where: {
        deletedAt: null,
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.ownerUserId ? { ownerUserId: query.ownerUserId } : {}),
        ...(query.publicationStatus
          ? { publicationStatus: query.publicationStatus as never }
          : {}),
        ...this.buildSearchFilter(query.search),
      },
      include: itemDetailInclude,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: query.take ?? 100,
    })

    return Promise.all(
      items.map(item =>
        this.serializeItem(item, { includeOwnerModerationReport: true })
      )
    )
  }

  async listPublicItems(query: ListCatalogItemsQueryDto) {
    const items = await this.prismaService.catalogItem.findMany({
      where: {
        deletedAt: null,
        ...this.buildPublicPublicationStatusFilter(query.publicationStatus),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.ownerUserId ? { ownerUserId: query.ownerUserId } : {}),
        ...this.buildSearchFilter(query.search),
      },
      include: itemDetailInclude,
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: query.take ?? 20,
    })

    const serializedItems = await Promise.all(
      items.map(item => this.serializeItem(item))
    )
    const rankingSignalsByOwner =
      await this.buildCatalogOwnerRankingSignals(serializedItems)

    return serializedItems
      .map(item => {
        const rankingSignals =
          rankingSignalsByOwner.get(item.ownerUserId) ??
          this.buildFallbackRankingSignals(item)

        return {
          ...item,
          rankingSignals,
        }
      })
      .sort((left, right) => {
        const scoreDifference =
          (right.rankingSignals?.score ?? 0) - (left.rankingSignals?.score ?? 0)

        if (scoreDifference !== 0) {
          return scoreDifference
        }

        return (
          new Date(right.publishedAt ?? right.createdAt).getTime() -
          new Date(left.publishedAt ?? left.createdAt).getTime()
        )
      })
  }

  async getItemDetail(itemId: string, actor?: CatalogActor) {
    const item = await this.prismaService.catalogItem.findUnique({
      where: {
        id: itemId,
      },
      include: itemDetailInclude,
    })

    if (!item || item.deletedAt) {
      throw new NotFoundException('Catalog item not found')
    }

    const isOwner = actor?.userId === item.ownerUserId

    if (
      !isOwner &&
      ![
        CatalogItemPublicationStatus.ACTIVE,
        CatalogItemPublicationStatus.IN_NEGOTIATION,
      ].includes(item.publicationStatus as CatalogItemPublicationStatus)
    ) {
      throw new NotFoundException('Catalog item not found')
    }

    const serializedItem = await this.serializeItem(item, {
      includeOwnerModerationReport: isOwner,
    })
    const rankingSignalsByOwner = await this.buildCatalogOwnerRankingSignals([
      serializedItem,
    ])

    return {
      ...serializedItem,
      rankingSignals:
        rankingSignalsByOwner.get(item.ownerUserId) ??
        this.buildFallbackRankingSignals(serializedItem),
    }
  }

  async adminUpdatePublicationStatus(
    itemId: string,
    publicationStatus: CatalogItemPublicationStatus
  ) {
    const existingItem = await this.prismaService.catalogItem.findUnique({
      where: {
        id: itemId,
      },
      include: itemDetailInclude,
    })

    if (!existingItem || existingItem.deletedAt) {
      throw new NotFoundException('Catalog item not found')
    }

    const shouldPublishNow =
      publicationStatus === CatalogItemPublicationStatus.ACTIVE &&
      !existingItem.publishedAt

    const item = await this.prismaService.catalogItem.update({
      where: {
        id: itemId,
      },
      data: {
        publicationStatus: publicationStatus as never,
        ...(shouldPublishNow ? { publishedAt: new Date() } : {}),
      },
      include: itemDetailInclude,
    })

    return this.serializeItem(item, { includeOwnerModerationReport: true })
  }

  async adminDeleteItem(itemId: string, reason?: string) {
    const existingItem = await this.prismaService.catalogItem.findUnique({
      where: {
        id: itemId,
      },
      select: {
        id: true,
        deletedAt: true,
      },
    })

    if (!existingItem || existingItem.deletedAt) {
      throw new NotFoundException('Catalog item not found')
    }

    const deletedAt = new Date()
    const trashExpiresAt = new Date(deletedAt)
    trashExpiresAt.setDate(trashExpiresAt.getDate() + TRASH_RECOVERY_DAYS)

    await this.prismaService.catalogItem.update({
      where: {
        id: itemId,
      },
      data: {
        deletedAt,
        trashExpiresAt,
        publicationStatus: CatalogItemPublicationStatus.INACTIVE as never,
        ...(reason
          ? {
              ownerModerationReport: {
                adminDeletionReason: sanitizePlainText(reason, {
                  preserveNewLines: true,
                }),
                deletedAt: deletedAt.toISOString(),
              } as Prisma.InputJsonValue,
            }
          : {}),
      },
    })

    return {
      success: true,
      itemId,
      deletedAt,
      trashExpiresAt,
    }
  }

  async getOwnedActiveItemOrThrow(actor: CatalogActor, itemId: string) {
    const item = await this.getOwnedItemOrThrow(actor, itemId)

    if (
      ![
        CatalogItemPublicationStatus.ACTIVE,
        CatalogItemPublicationStatus.IN_NEGOTIATION,
      ].includes(item.publicationStatus as CatalogItemPublicationStatus)
    ) {
      throw new BadRequestException('Only active items can be offered')
    }

    return item
  }

  async getOwnedItemOrThrow(actor: CatalogActor, itemId: string) {
    const item = await this.prismaService.catalogItem.findUnique({
      where: {
        id: itemId,
      },
    })

    if (!item || item.deletedAt) {
      throw new NotFoundException('Catalog item not found')
    }

    if (item.ownerUserId !== actor.userId) {
      throw new ForbiddenException('You can only use your own item')
    }

    return item
  }

  private async getItemWithRelationsOrThrow(itemId: string) {
    const item = await this.prismaService.catalogItem.findUnique({
      where: {
        id: itemId,
      },
      include: itemDetailInclude,
    })

    if (!item || item.deletedAt) {
      throw new NotFoundException('Catalog item not found')
    }

    return item
  }

  async getPublicNegotiableItemOrThrow(itemId: string) {
    const item = await this.prismaService.catalogItem.findUnique({
      where: {
        id: itemId,
      },
    })

    if (!item || item.deletedAt) {
      throw new NotFoundException('Catalog item not found')
    }

    if (
      ![
        CatalogItemPublicationStatus.ACTIVE,
        CatalogItemPublicationStatus.IN_NEGOTIATION,
      ].includes(item.publicationStatus as CatalogItemPublicationStatus)
    ) {
      throw new BadRequestException('Requested item is not available')
    }

    return item
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
    })

    if (!item || item.deletedAt) {
      return
    }

    const activeNegotiationsCount =
      await this.negotiationPolicyService.countActiveNegotiationsForItem(itemId)

    if (
      activeNegotiationsCount > 0 &&
      item.publicationStatus === CatalogItemPublicationStatus.ACTIVE
    ) {
      await this.prismaService.catalogItem.update({
        where: {
          id: itemId,
        },
        data: {
          publicationStatus:
            CatalogItemPublicationStatus.IN_NEGOTIATION as never,
        },
      })
      return
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
      })
    }
  }

  private async generateUniqueSlug(title: string) {
    const base = slugifyCatalogTitle(title)

    if (!base) {
      throw new BadRequestException('Title is invalid')
    }

    const existingCount = await this.prismaService.catalogItem.count({
      where: {
        slug: {
          startsWith: base,
        },
      },
    })

    return existingCount === 0 ? base : `${base}-${existingCount + 1}`
  }

  private buildPublicationStatusFilter(
    publicationStatus?: CatalogItemPublicationStatus
  ) {
    if (!publicationStatus) {
      return {
        publicationStatus: {
          in: [
            CatalogItemPublicationStatus.ACTIVE,
            CatalogItemPublicationStatus.IN_NEGOTIATION,
          ] as never,
        },
      }
    }

    if (publicationStatus === CatalogItemPublicationStatus.ACTIVE) {
      return {
        publicationStatus: {
          in: [
            CatalogItemPublicationStatus.ACTIVE,
            CatalogItemPublicationStatus.IN_NEGOTIATION,
          ] as never,
        },
      }
    }

    return {
      publicationStatus: publicationStatus as never,
    }
  }

  private buildPublicPublicationStatusFilter(
    publicationStatus?: CatalogItemPublicationStatus
  ) {
    if (
      publicationStatus &&
      publicationStatus !== CatalogItemPublicationStatus.ACTIVE
    ) {
      throw new BadRequestException('Only active catalog items can be listed')
    }

    return {
      publicationStatus: {
        in: [
          CatalogItemPublicationStatus.ACTIVE,
          CatalogItemPublicationStatus.IN_NEGOTIATION,
        ] as never,
      },
    }
  }

  private hasModeratableContentChange(input: Partial<UpdateCatalogItemDto>) {
    return [
      input.title,
      input.description,
      input.categoryId,
      input.condition,
      input.subjectiveValue,
      input.exchangePreferences,
      input.images,
    ].some(value => value !== undefined)
  }

  private isPublicPublicationStatus(status: string) {
    return [
      CatalogItemPublicationStatus.ACTIVE,
      CatalogItemPublicationStatus.IN_NEGOTIATION,
    ].includes(status as CatalogItemPublicationStatus)
  }

  private isReviewCyclePublicationStatus(status: string) {
    return [
      CatalogItemPublicationStatus.ACTIVE,
      CatalogItemPublicationStatus.IN_NEGOTIATION,
      CatalogItemPublicationStatus.UNDER_REVIEW,
    ].includes(status as CatalogItemPublicationStatus)
  }

  private shouldSetPublishedAt(
    status: string,
    shouldQueuePublicationReview: boolean
  ) {
    return (
      !shouldQueuePublicationReview &&
      status === CatalogItemPublicationStatus.ACTIVE
    )
  }

  private normalizeImages(
    images?: CreateCatalogItemDto['images'] | UpdateCatalogItemDto['images']
  ) {
    const normalized = (images ?? []).map((image, index) => {
      const storagePath = image.storagePath?.trim() || undefined
      const storageUrl =
        image.storageUrl?.trim() ||
        (storagePath
          ? this.storageService.createCatalogItemImagePublicUrl(storagePath)
          : '')

      if (!storageUrl) {
        throw new BadRequestException(
          'Each catalog image must define a storage URL or storage path'
        )
      }

      return {
        storageUrl,
        storagePath,
        sortOrder: image.sortOrder ?? index,
        isCover: Boolean(image.isCover),
      }
    })

    if (!normalized.length) {
      return normalized
    }

    const firstCoverIndex = normalized.findIndex(image => image.isCover)

    if (firstCoverIndex === -1) {
      normalized[0].isCover = true
    }

    if (firstCoverIndex > -1) {
      normalized.forEach((image, index) => {
        image.isCover = index === firstCoverIndex
      })
    }

    return normalized.sort((left, right) => left.sortOrder - right.sortOrder)
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
    }
  }

  private buildSearchFilter(search?: string) {
    if (!search) {
      return {}
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
    }
  }

  private async serializeItem(
    item: CatalogItemWithRelations,
    options?: {
      includeOwnerModerationReport?: boolean
    }
  ) {
    const activeNegotiationsCount =
      await this.negotiationPolicyService.countActiveNegotiationsForItem(
        item.id
      )

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
      trashExpiresAt: item.trashExpiresAt,
      activeNegotiationsCount,
      ...(options?.includeOwnerModerationReport
        ? {
            ownerModerationReport: item.ownerModerationReport,
          }
        : {}),
      images: await Promise.all(
        item.images.map(image => this.serializeImage(image))
      ),
    }
  }

  private async buildCatalogOwnerRankingSignals(items: {
    ownerUserId: string
    publishedAt?: Date | string | null
    createdAt: Date | string
    activeNegotiationsCount?: number
  }[]) {
    const uniqueOwnerUserIds = [...new Set(items.map(item => item.ownerUserId))]

    if (uniqueOwnerUserIds.length === 0) {
      return new Map<string, CatalogOwnerRankingSignals>()
    }

    const [ownerSignalsList, ownerRatingGroups] = await Promise.all([
      Promise.all(
        uniqueOwnerUserIds.map(async ownerUserId => [
          ownerUserId,
          await this.identitySignalsService.getSignalsForUser(ownerUserId),
        ] as const)
      ),
      this.prismaService.exchangeMatchFeedback.groupBy({
        by: ['reviewedUserId'],
        where: {
          reviewedUserId: {
            in: uniqueOwnerUserIds,
          },
          wasEffectiveInPerson: true,
        },
        _avg: {
          rating: true,
        },
        _count: {
          _all: true,
        },
      }),
    ])

    const ownerSignalMap = new Map(ownerSignalsList)
    const ownerRatingsMap = new Map(
      ownerRatingGroups.map(group => [
        group.reviewedUserId,
        {
          averageRating: group._avg.rating ?? null,
          ratingCount: group._count._all,
        },
      ])
    )

    const rankingSignalsByOwner = new Map<string, CatalogOwnerRankingSignals>()

    for (const ownerUserId of uniqueOwnerUserIds) {
      const ownerSignals = ownerSignalMap.get(ownerUserId)
      const ownerRatings = ownerRatingsMap.get(ownerUserId)
      const ownerRepresentativeItem =
        items.find(item => item.ownerUserId === ownerUserId) ?? null
      const score = this.calculateCatalogOwnerRankingScore({
        ownerIsPremium: Boolean(ownerSignals?.isPremium),
        ownerAverageRating: ownerRatings?.averageRating ?? null,
        ownerRatingCount: ownerRatings?.ratingCount ?? 0,
        activeNegotiationsCount:
          ownerRepresentativeItem?.activeNegotiationsCount ?? 0,
        publishedAt:
          ownerRepresentativeItem?.publishedAt ??
          ownerRepresentativeItem?.createdAt ??
          null,
      })

      rankingSignalsByOwner.set(ownerUserId, {
        ownerIsPremium: Boolean(ownerSignals?.isPremium),
        ownerAverageRating: ownerRatings?.averageRating ?? null,
        ownerRatingCount: ownerRatings?.ratingCount ?? 0,
        score,
      })
    }

    return rankingSignalsByOwner
  }

  private buildFallbackRankingSignals(item: {
    publishedAt?: Date | string | null
    createdAt: Date | string
    activeNegotiationsCount: number
  }): CatalogOwnerRankingSignals {
    return {
      ownerIsPremium: false,
      ownerAverageRating: null,
      ownerRatingCount: 0,
      score: this.calculateCatalogOwnerRankingScore({
        ownerIsPremium: false,
        ownerAverageRating: null,
        ownerRatingCount: 0,
        activeNegotiationsCount: item.activeNegotiationsCount,
        publishedAt: item.publishedAt ?? item.createdAt,
      }),
    }
  }

  private calculateCatalogOwnerRankingScore(input: {
    ownerIsPremium: boolean
    ownerAverageRating: number | null
    ownerRatingCount: number
    activeNegotiationsCount: number
    publishedAt: Date | string | null
  }) {
    const premiumBoost = input.ownerIsPremium ? 1000 : 0
    const ratingBoost = (input.ownerAverageRating ?? 0) * 100
    const ratingVolumeBoost = Math.min(input.ownerRatingCount, 50) * 4
    const negotiationBoost = Math.min(input.activeNegotiationsCount, 20) * 3
    const publishedAt = input.publishedAt ? new Date(input.publishedAt) : null
    const itemAgeHours =
      publishedAt && !Number.isNaN(publishedAt.getTime())
        ? Math.max(
            0,
            (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60)
          )
        : 24 * 30
    const freshnessBoost = Math.max(0, 72 - itemAgeHours) / 6

    return Math.round(
      premiumBoost +
        ratingBoost +
        ratingVolumeBoost +
        negotiationBoost +
        freshnessBoost
    )
  }

  private serializeCategory(category: CatalogCategory) {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      parentId: category.parentId,
      path: category.path,
      depth: category.depth,
    }
  }

  private async serializeImage(image: CatalogItemImage) {
    const readableStorageUrl = image.storagePath
      ? await this.storageService.createCatalogItemImageReadUrl(
          image.storagePath
        )
      : image.storageUrl

    return {
      id: image.id,
      storageUrl: readableStorageUrl,
      storagePath: image.storagePath,
      sortOrder: image.sortOrder,
      isCover: image.isCover,
      createdAt: image.createdAt,
    }
  }
}
