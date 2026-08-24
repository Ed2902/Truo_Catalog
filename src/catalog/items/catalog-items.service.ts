import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, randomUUID } from 'crypto'
import {
  CatalogCategory,
  CatalogImageModerationStatus,
  CatalogItemImage,
  Prisma,
} from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'
import { StorageService } from '../../storage/storage.service'
import { sanitizePlainText } from '../../common/utils/sanitize-text.util'
import { HomePerformanceService } from '../../common/observability/home-performance.service'
import { CircuitBreakerService } from '../../common/resilience/circuit-breaker.service'
import { CatalogItemPublicationStatus } from '../shared/catalog.constants'
import { CatalogCategoriesService } from '../categories/catalog-categories.service'
import { CatalogDuplicatePolicyService } from './catalog-duplicate-policy.service'
import { CatalogNegotiationPolicyService } from '../exchanges/catalog-negotiation-policy.service'
import {
  IdentityOwnerSummary,
  IdentitySignalsService,
} from '../identity/identity-signals.service'
import { CatalogPublicationModerationService } from '../moderation/catalog-publication-moderation.service'
import { CatalogOutboxService } from '../outbox/catalog-outbox.service'
import { CreateCatalogItemDto } from '../dto/create-catalog-item.dto'
import { ListAdminCatalogItemsQueryDto } from '../dto/list-admin-catalog-items-query.dto'
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
const HOME_FEED_PAGE_CACHE_TTL_SECONDS = 20
const HOME_FEED_SNAPSHOT_TTL_SECONDS = 120
const HOME_FEED_CANDIDATE_LIMIT = 500
const OWNER_SUMMARY_CACHE_TTL_SECONDS = 60
const OWNER_RATING_CACHE_TTL_SECONDS = 5 * 60
const ACTIVE_NEGOTIATION_CACHE_TTL_SECONDS = 30
const MEDIA_READ_URL_CACHE_TTL_SECONDS = 5 * 60

type CatalogOwnerRankingSignals = {
  ownerIsPremium: boolean
  ownerAverageRating: number | null
  ownerRatingCount: number
  ownerFollowedByViewer: boolean
  score: number
}

type CatalogHomeFeedResponse = {
  items: Array<Record<string, unknown>>
  generatedAt: string
  viewer: {
    userId: string | null
  }
  pageInfo: {
    take: number
    feedVersion: string
    cursor: string | null
    nextCursor: string | null
    hasMore: boolean
  }
}

type CatalogPublicFeedPage = {
  items: Array<Record<string, unknown>>
  pageInfo: {
    take: number
    feedVersion: string
    cursor: string | null
    nextCursor: string | null
    hasMore: boolean
  }
}

type CatalogFeedCursor = {
  feedVersion: string
  position: number
  score: number
  publishedAt: string | null
  id: string
}

type CatalogRankedFeedSnapshot = {
  feedVersion: string
  queryHash: string
  generatedAt: string
  items: Array<Record<string, unknown>>
}

type CatalogOwnerRatingSummary = {
  averageRating: number | null
  ratingCount: number
}

type CatalogOwnerSummaryCacheEntry = {
  summary: IdentityOwnerSummary | null
  isRestricted: boolean
}

@Injectable()
export class CatalogItemsService {
  private readonly logger = new Logger(CatalogItemsService.name)

  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    private readonly homePerformanceService: HomePerformanceService,
    private readonly circuitBreakerService: CircuitBreakerService,
    private readonly categoriesService: CatalogCategoriesService,
    private readonly duplicatePolicyService: CatalogDuplicatePolicyService,
    private readonly negotiationPolicyService: CatalogNegotiationPolicyService,
    private readonly identitySignalsService: IdentitySignalsService,
    private readonly catalogOutboxService: CatalogOutboxService,
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

    await this.invalidateItemFeedCaches(item.id, item.ownerUserId)

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

    await this.invalidateItemFeedCaches(item.id, item.ownerUserId)

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

    await this.invalidateItemFeedCaches(itemId, existingItem.ownerUserId)

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

    await this.invalidateItemFeedCaches(item.id, item.ownerUserId)

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

  async listAdminItems(query: ListAdminCatalogItemsQueryDto) {
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
      skip: query.skip ?? 0,
      take: query.take ?? 100,
    })

    return Promise.all(
      items.map(item =>
        this.serializeItem(item, { includeOwnerModerationReport: true })
      )
    )
  }

  async getHomeFeed(
    query: ListCatalogItemsQueryDto,
    actor?: CatalogActor
  ): Promise<CatalogHomeFeedResponse> {
    const startedAt = Date.now()
    const pageCacheKey = this.buildHomeFeedPageCacheKey(query, actor)
    const cachedFeed =
      await this.getCachedJson<CatalogHomeFeedResponse>(pageCacheKey)

    if (cachedFeed) {
      this.logger.log({
        event: 'catalog.home_feed.page_cache',
        result: 'hit',
        durationMs: Date.now() - startedAt,
        viewerUserId: actor?.userId ?? null,
        take: query.take ?? 20,
        hasCursor: Boolean(query.cursor),
        feedVersion: cachedFeed.pageInfo.feedVersion,
        itemsCount: cachedFeed.items.length,
      })
      return cachedFeed
    }

    const page = await this.buildPublicFeedPage(query, actor)

    const response: CatalogHomeFeedResponse = {
      items: page.items,
      generatedAt: new Date().toISOString(),
      viewer: {
        userId: actor?.userId ?? null,
      },
      pageInfo: page.pageInfo,
    }

    await this.setCachedJson(
      pageCacheKey,
      response,
      HOME_FEED_PAGE_CACHE_TTL_SECONDS
    )
    await this.catalogOutboxService.trackHomeFeedPage(
      pageCacheKey,
      this.extractOwnerUserIds(page.items),
      actor?.userId ?? null
    )

    this.logger.log({
      event: 'catalog.home_feed.page_cache',
      result: 'miss',
      durationMs: Date.now() - startedAt,
      viewerUserId: actor?.userId ?? null,
      take: query.take ?? 20,
      hasCursor: Boolean(query.cursor),
      feedVersion: response.pageInfo.feedVersion,
      itemsCount: response.items.length,
    })

    return response
  }

  async listPublicItems(query: ListCatalogItemsQueryDto, actor?: CatalogActor) {
    const page = await this.buildPublicFeedPage(query, actor)
    return page.items
  }

  private async buildPublicFeedPage(
    query: ListCatalogItemsQueryDto,
    actor?: CatalogActor
  ): Promise<CatalogPublicFeedPage> {
    const take = query.take ?? 20
    const queryHash = this.buildFeedQueryHash(query)
    const cursor = query.cursor ? this.decodeFeedCursor(query.cursor) : null
    const snapshot = cursor
      ? await this.readFeedSnapshot(query, actor, cursor)
      : await this.buildAndCacheFeedSnapshot(query, actor, queryHash)
    const startIndex = cursor
      ? this.resolveSnapshotStartIndex(snapshot, cursor)
      : 0
    const pageItems = snapshot.items.slice(startIndex, startIndex + take)
    const hasMore = startIndex + take < snapshot.items.length
    const lastItem = pageItems[pageItems.length - 1] ?? null
    const nextCursor =
      hasMore && lastItem
        ? this.encodeFeedCursor({
            feedVersion: snapshot.feedVersion,
            position: startIndex + pageItems.length - 1,
            score: this.resolveItemScore(lastItem),
            publishedAt: this.resolveItemPublishedAt(lastItem),
            id: String(lastItem.id),
          })
        : null

    return {
      items: pageItems,
      pageInfo: {
        take,
        feedVersion: snapshot.feedVersion,
        cursor: query.cursor ?? null,
        nextCursor,
        hasMore,
      },
    }
  }

  private async buildAndCacheFeedSnapshot(
    query: ListCatalogItemsQueryDto,
    actor: CatalogActor | undefined,
    queryHash: string
  ): Promise<CatalogRankedFeedSnapshot> {
    const startedAt = Date.now()
    const rows = await this.prismaService.catalogItem.findMany({
      where: {
        deletedAt: null,
        ...this.buildPublicPublicationStatusFilter(query.publicationStatus),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.ownerUserId ? { ownerUserId: query.ownerUserId } : {}),
        ...this.buildSearchFilter(query.search),
      },
      include: itemDetailInclude,
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: HOME_FEED_CANDIDATE_LIMIT,
    })

    const ownerSummariesResult = await this.getCachedOwnerSummaries(
      [...new Set(rows.map(item => item.ownerUserId))],
      actor
    )
    const visibleItems = rows.filter(
      item => !ownerSummariesResult.hiddenUserIds.has(item.ownerUserId)
    )
    const activeNegotiationsByItemId =
      await this.getCachedActiveNegotiationsCounts(
        visibleItems.map(item => item.id)
      )

    const serializedItems = await this.mapWithConcurrency(
      visibleItems,
      this.getHomeSerializationConcurrency(),
      item =>
        this.serializeItem(item, {
          activeNegotiationsCount:
            activeNegotiationsByItemId.get(item.id) ?? 0,
          ownerSummary:
            ownerSummariesResult.summaries.get(item.ownerUserId) ?? null,
        })
    )
    const rankingSignalsByOwner =
      await this.buildCatalogOwnerRankingSignals(
        serializedItems,
        ownerSummariesResult.summaries
      )

    const rankedItems = serializedItems
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
    const snapshot: CatalogRankedFeedSnapshot = {
      feedVersion: query.feedVersion?.trim() || randomUUID(),
      queryHash,
      generatedAt: new Date().toISOString(),
      items: rankedItems,
    }

    const snapshotCacheKey = this.buildFeedSnapshotCacheKey(
      query,
      actor,
      snapshot.feedVersion
    )

    await this.setCachedJson(
      snapshotCacheKey,
      snapshot,
      HOME_FEED_SNAPSHOT_TTL_SECONDS
    )
    await this.catalogOutboxService.trackHomeFeedSnapshot(
      snapshotCacheKey,
      this.extractOwnerUserIds(rankedItems),
      actor?.userId ?? null
    )

    this.homePerformanceService.addDuration(
      'snapshotBuild',
      Date.now() - startedAt
    )

    this.logger.log({
      event: 'catalog.home_feed.snapshot_built',
      durationMs: Date.now() - startedAt,
      viewerUserId: actor?.userId ?? null,
      feedVersion: snapshot.feedVersion,
      candidateRowsCount: rows.length,
      visibleItemsCount: visibleItems.length,
      rankedItemsCount: rankedItems.length,
      hiddenOwnersCount: ownerSummariesResult.hiddenUserIds.size,
      identityDegraded: Boolean(ownerSummariesResult.degraded),
    })

    return snapshot
  }

  private buildHomeFeedPageCacheKey(
    query: ListCatalogItemsQueryDto,
    actor?: CatalogActor
  ) {
    return `catalog:home-feed:page:${actor?.userId ?? 'anonymous'}:${this.hashJson({
      query: this.normalizeFeedQuery(query),
      take: query.take ?? 20,
      cursor: query.cursor ?? null,
      feedVersion: query.feedVersion ?? null,
    })}`
  }

  private buildFeedSnapshotCacheKey(
    query: ListCatalogItemsQueryDto,
    actor: CatalogActor | undefined,
    feedVersion: string
  ) {
    return `catalog:home-feed:snapshot:${actor?.userId ?? 'anonymous'}:${feedVersion}:${this.buildFeedQueryHash(query)}`
  }

  private buildFeedQueryHash(query: ListCatalogItemsQueryDto) {
    return this.hashJson(this.normalizeFeedQuery(query))
  }

  private normalizeFeedQuery(query: ListCatalogItemsQueryDto) {
    return {
      categoryId: query.categoryId ?? null,
      ownerUserId: query.ownerUserId ?? null,
      search: query.search?.trim() || null,
      publicationStatus: query.publicationStatus ?? null,
    }
  }

  private async readFeedSnapshot(
    query: ListCatalogItemsQueryDto,
    actor: CatalogActor | undefined,
    cursor: CatalogFeedCursor
  ) {
    const snapshot = await this.getCachedJson<CatalogRankedFeedSnapshot>(
      this.buildFeedSnapshotCacheKey(query, actor, cursor.feedVersion)
    )

    if (!snapshot) {
      this.logger.warn({
        event: 'catalog.home_feed.snapshot_cache',
        result: 'miss',
        viewerUserId: actor?.userId ?? null,
        feedVersion: cursor.feedVersion,
      })
      throw new BadRequestException(
        'Feed cursor expired. Refresh the feed from the first page.'
      )
    }

    this.logger.log({
      event: 'catalog.home_feed.snapshot_cache',
      result: 'hit',
      viewerUserId: actor?.userId ?? null,
      feedVersion: cursor.feedVersion,
      itemsCount: snapshot.items.length,
    })

    if (snapshot.queryHash !== this.buildFeedQueryHash(query)) {
      throw new BadRequestException('Feed cursor does not match this query')
    }

    return snapshot
  }

  private resolveSnapshotStartIndex(
    snapshot: CatalogRankedFeedSnapshot,
    cursor: CatalogFeedCursor
  ) {
    const itemAtPosition = snapshot.items[cursor.position]

    if (itemAtPosition?.id === cursor.id) {
      return cursor.position + 1
    }

    const fallbackIndex = snapshot.items.findIndex(
      item =>
        item.id === cursor.id &&
        this.resolveItemScore(item) === cursor.score &&
        this.resolveItemPublishedAt(item) === cursor.publishedAt
    )

    if (fallbackIndex === -1) {
      throw new BadRequestException('Feed cursor is no longer valid')
    }

    return fallbackIndex + 1
  }

  private encodeFeedCursor(cursor: CatalogFeedCursor) {
    return Buffer.from(JSON.stringify(cursor)).toString('base64url')
  }

  private decodeFeedCursor(cursor: string): CatalogFeedCursor {
    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8')
      ) as Partial<CatalogFeedCursor>

      if (
        !parsed.feedVersion ||
        typeof parsed.position !== 'number' ||
        typeof parsed.score !== 'number' ||
        !parsed.id
      ) {
        throw new Error('Incomplete cursor')
      }

      return {
        feedVersion: parsed.feedVersion,
        position: parsed.position,
        score: parsed.score,
        publishedAt: parsed.publishedAt ?? null,
        id: parsed.id,
      }
    } catch {
      throw new BadRequestException('Invalid feed cursor')
    }
  }

  private resolveItemScore(item: Record<string, unknown>) {
    const rankingSignals = item.rankingSignals as
      | { score?: number }
      | null
      | undefined

    return rankingSignals?.score ?? 0
  }

  private resolveItemPublishedAt(item: Record<string, unknown>) {
    const publishedAt = item.publishedAt ?? item.createdAt ?? null

    if (!publishedAt) {
      return null
    }

    return new Date(publishedAt as string | Date).toISOString()
  }

  private extractOwnerUserIds(items: Array<Record<string, unknown>>) {
    return [
      ...new Set(
        items
          .map(item => item.ownerUserId)
          .filter((ownerUserId): ownerUserId is string =>
            typeof ownerUserId === 'string'
          )
      ),
    ]
  }

  private hashJson(value: unknown) {
    return createHash('sha256')
      .update(JSON.stringify(value))
      .digest('hex')
      .slice(0, 24)
  }

  private async getCachedJson<T>(key: string) {
    const startedAt = Date.now()
    try {
      const value = await this.withTimeout(
        'redisRead',
        this.getHomeRedisTimeoutMs(),
        this.circuitBreakerService.execute('redis-cache', () =>
          this.redisService.getJson<T>(key)
        )
      )
      this.homePerformanceService.recordRedisRead({
        durationMs: Date.now() - startedAt,
        hit: value !== null && value !== undefined,
      })
      return value
    } catch (error) {
      const durationMs = Date.now() - startedAt
      this.homePerformanceService.recordRedisRead({
        durationMs,
        error: true,
      })
      this.homePerformanceService.addDegraded(
        'redisCache',
        'read_failed',
        durationMs
      )
      this.logger.warn({ err: error, key }, 'Redis cache read failed')
      return null
    }
  }

  private async setCachedJson(
    key: string,
    value: unknown,
    ttlSeconds: number
  ) {
    const startedAt = Date.now()
    try {
      await this.withTimeout(
        'redisWrite',
        this.getHomeRedisTimeoutMs(),
        this.circuitBreakerService.execute('redis-cache', () =>
          this.redisService.setJson(key, value, ttlSeconds)
        )
      )
      this.homePerformanceService.recordRedisWrite({
        durationMs: Date.now() - startedAt,
      })
    } catch (error) {
      this.homePerformanceService.recordRedisWrite({
        durationMs: Date.now() - startedAt,
        error: true,
      })
      this.homePerformanceService.addDegraded(
        'redisCache',
        'write_failed',
        Date.now() - startedAt
      )
      this.logger.warn({ err: error, key }, 'Redis cache write failed')
    }
  }

  private async getCachedJsonMap<T>(keys: string[]) {
    const startedAt = Date.now()
    const uniqueKeys = [...new Set(keys.filter(Boolean))]

    try {
      const valuesByKey = await this.withTimeout(
        'redisRead',
        this.getHomeRedisTimeoutMs(),
        this.circuitBreakerService.execute('redis-cache', () =>
          this.redisService.mgetJson<T>(uniqueKeys)
        )
      )
      const durationMs = Date.now() - startedAt

      for (const key of uniqueKeys) {
        this.homePerformanceService.recordRedisRead({
          durationMs,
          hit: valuesByKey.has(key),
        })
      }

      return valuesByKey
    } catch (error) {
      const durationMs = Date.now() - startedAt

      for (const key of uniqueKeys) {
        this.homePerformanceService.recordRedisRead({
          durationMs,
          error: true,
        })
      }

      this.homePerformanceService.addDegraded(
        'redisCache',
        'batch_read_failed',
        durationMs
      )
      this.logger.warn(
        { err: error, keysCount: uniqueKeys.length },
        'Redis cache batch read failed'
      )
      return new Map<string, T>()
    }
  }

  private async setCachedJsonMap(
    entries: Array<{ key: string; value: unknown }>,
    ttlSeconds: number
  ) {
    const startedAt = Date.now()

    try {
      await this.withTimeout(
        'redisWrite',
        this.getHomeRedisTimeoutMs(),
        this.circuitBreakerService.execute('redis-cache', () =>
          this.redisService.msetJson(entries, ttlSeconds)
        )
      )

      for (const entry of entries) {
        this.homePerformanceService.recordRedisWrite({
          durationMs: Date.now() - startedAt,
          error: !entry.key,
        })
      }
    } catch (error) {
      const durationMs = Date.now() - startedAt

      for (const entry of entries) {
        this.homePerformanceService.recordRedisWrite({
          durationMs,
          error: true,
        })
      }

      this.homePerformanceService.addDegraded(
        'redisCache',
        'batch_write_failed',
        durationMs
      )
      this.logger.warn(
        { err: error, entriesCount: entries.length },
        'Redis cache batch write failed'
      )
    }
  }

  private getHomeTimeoutMs(
    key: 'ratingsTimeoutMs' | 'mediaTimeoutMs' | 'redisTimeoutMs'
  ) {
    const fallbacks = {
      ratingsTimeoutMs: 500,
      mediaTimeoutMs: 500,
      redisTimeoutMs: 250,
    }

    return (
      this.configService.get<number | undefined>(`homePerformance.${key}`) ??
      fallbacks[key]
    )
  }

  private getHomeRedisTimeoutMs() {
    return this.getHomeTimeoutMs('redisTimeoutMs')
  }

  private getHomeSerializationConcurrency() {
    return (
      this.configService.get<number | undefined>(
        'homePerformance.serializationConcurrency'
      ) ?? 8
    )
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>
  ) {
    const results: R[] = new Array(items.length)
    let nextIndex = 0
    const workerCount = Math.max(1, Math.min(concurrency, items.length))

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
          const currentIndex = nextIndex
          nextIndex += 1
          results[currentIndex] = await mapper(items[currentIndex], currentIndex)
        }
      })
    )

    return results
  }

  private async withTimeout<T>(
    component: string,
    timeoutMs: number,
    operation: Promise<T>
  ) {
    let timeout: NodeJS.Timeout | undefined

    try {
      return await Promise.race([
        operation,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(() => {
            this.homePerformanceService.addTimeout(component, timeoutMs)
            this.logger.warn({
              event: 'catalog.home.component_timeout',
              component,
              timeoutMs,
            })
            reject(new Error(`${component} exceeded ${timeoutMs}ms`))
          }, timeoutMs)
        }),
      ])
    } finally {
      if (timeout) {
        clearTimeout(timeout)
      }
    }
  }

  private async getCachedOwnerSummaries(
    userIds: string[],
    actor?: CatalogActor
  ) {
    const viewerKey = actor?.userId ?? 'anonymous'
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))]
    const summaries = new Map<string, IdentityOwnerSummary>()
    const hiddenUserIds = new Set<string>()
    const missingUserIds: string[] = []
    const cacheKeysByUserId = new Map(
      uniqueUserIds.map(userId => [
        userId,
        `catalog:owner-summary:${viewerKey}:${userId}`,
      ])
    )
    const cachedEntries =
      await this.getCachedJsonMap<CatalogOwnerSummaryCacheEntry>(
        Array.from(cacheKeysByUserId.values())
      )

    for (const userId of uniqueUserIds) {
      const cacheKey = cacheKeysByUserId.get(userId) as string
      const cachedEntry = cachedEntries.get(cacheKey)

      if (!cachedEntry) {
        missingUserIds.push(userId)
        continue
      }

      if (cachedEntry.isRestricted) {
        hiddenUserIds.add(userId)
      }

      if (cachedEntry.summary) {
        summaries.set(userId, cachedEntry.summary)
      }
    }

    if (!missingUserIds.length) {
      return {
        summaries,
        hiddenUserIds,
        degraded: false,
      }
    }

    const freshResult = await this.identitySignalsService.getOwnerSummaries(
      missingUserIds,
      actor
    )

    if (freshResult.degraded && actor) {
      for (const userId of missingUserIds) {
        hiddenUserIds.add(userId)
      }

      this.homePerformanceService.addDegraded(
        'identityOwnerSummaries',
        'fail_closed_missing_owner_summaries'
      )
      this.homePerformanceService.addFallback(
        'visibility',
        'hide_unverified_owners'
      )

      this.logger.warn({
        event: 'catalog.home.degraded_component',
        component: 'identityOwnerSummaries',
        reason: 'fail_closed_missing_owner_summaries',
        viewerUserId: actor.userId,
        hiddenOwnersCount: missingUserIds.length,
      })

      return {
        summaries,
        hiddenUserIds,
        degraded: true,
      }
    }

    const shouldCacheFreshResult =
      freshResult.summaries.size > 0 || freshResult.hiddenUserIds.size > 0

    const freshCacheEntries: Array<{ key: string; value: unknown }> = []

    for (const userId of missingUserIds) {
      const summary = freshResult.summaries.get(userId) ?? null
      const isRestricted =
        freshResult.hiddenUserIds.has(userId) || Boolean(summary?.isRestricted)

      if (isRestricted) {
        hiddenUserIds.add(userId)
      }

      if (summary) {
        summaries.set(userId, summary)
      }

      if (shouldCacheFreshResult) {
        freshCacheEntries.push({
          key: cacheKeysByUserId.get(userId) as string,
          value: {
            summary,
            isRestricted,
          } satisfies CatalogOwnerSummaryCacheEntry,
        })
      }
    }

    if (freshCacheEntries.length) {
      await this.setCachedJsonMap(
        freshCacheEntries,
        OWNER_SUMMARY_CACHE_TTL_SECONDS
      )
    }

    return {
      summaries,
      hiddenUserIds,
      degraded: Boolean(freshResult.degraded),
    }
  }

  private async getCachedOwnerRatings(userIds: string[]) {
    const startedAt = Date.now()
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))]
    const ratingsByOwner = new Map<string, CatalogOwnerRatingSummary>()
    const missingUserIds: string[] = []
    let cacheHits = 0
    let cacheMisses = 0
    const cacheKeysByUserId = new Map(
      uniqueUserIds.map(userId => [userId, `catalog:owner-rating:${userId}`])
    )

    this.homePerformanceService.recordRatings({
      ownersRequested: uniqueUserIds.length,
    })

    try {
      const cachedRatings =
        await this.getCachedJsonMap<CatalogOwnerRatingSummary>(
          Array.from(cacheKeysByUserId.values())
        )

      for (const userId of uniqueUserIds) {
        const cachedRating = cachedRatings.get(
          cacheKeysByUserId.get(userId) as string
        )

        if (cachedRating) {
          cacheHits += 1
          ratingsByOwner.set(userId, cachedRating)
          continue
        }

        cacheMisses += 1
        missingUserIds.push(userId)
      }

      this.homePerformanceService.recordRatings({
        cacheHits,
        cacheMisses,
      })

      if (!missingUserIds.length) {
        return ratingsByOwner
      }

      const ownerRatingGroups = await this.withTimeout(
        'ratings',
        this.getHomeTimeoutMs('ratingsTimeoutMs'),
        this.prismaService.exchangeMatchFeedback.groupBy({
          by: ['reviewedUserId'],
          where: {
            reviewedUserId: {
              in: missingUserIds,
            },
            wasEffectiveInPerson: true,
          },
          _avg: {
            rating: true,
          },
          _count: {
            _all: true,
          },
        })
      )
      const freshRatingsMap = new Map(
        ownerRatingGroups.map(group => [
          group.reviewedUserId,
          {
            averageRating: group._avg.rating ?? null,
            ratingCount: group._count._all,
          } satisfies CatalogOwnerRatingSummary,
        ])
      )

      await this.setCachedJsonMap(
        missingUserIds.map(userId => {
          const rating = freshRatingsMap.get(userId) ?? {
            averageRating: null,
            ratingCount: 0,
          }

          ratingsByOwner.set(userId, rating)
          return {
            key: cacheKeysByUserId.get(userId) as string,
            value: rating,
          }
        }),
        OWNER_RATING_CACHE_TTL_SECONDS
      )

      return ratingsByOwner
    } catch (error) {
      this.homePerformanceService.recordRatings({
        fallbackOwners: missingUserIds.length || uniqueUserIds.length,
      })
      this.homePerformanceService.addDegraded('ratings', 'ratings_failed')
      this.homePerformanceService.addFallback(
        'ratings',
        'missing_ratings_as_null'
      )
      this.logger.warn({
        event: 'catalog.home.degraded_component',
        component: 'ratings',
        reason: 'ratings_failed',
        err: error,
        ownersCount: uniqueUserIds.length,
        missingOwnersCount: missingUserIds.length,
      })

      return ratingsByOwner
    } finally {
      this.homePerformanceService.addDuration(
        'ratings',
        Date.now() - startedAt
      )
    }
  }

  private async getCachedActiveNegotiationsCount(itemId: string) {
    const startedAt = Date.now()
    const cacheKey = `catalog:item:${itemId}:active-negotiations`
    this.homePerformanceService.recordActiveNegotiations({ requested: 1 })

    try {
      const cachedCount = await this.getCachedJson<number>(cacheKey)

      if (typeof cachedCount === 'number') {
        this.homePerformanceService.recordActiveNegotiations({ cacheHits: 1 })
        return cachedCount
      }

      this.homePerformanceService.recordActiveNegotiations({ cacheMisses: 1 })
      const activeNegotiationsCount =
        await this.negotiationPolicyService.countActiveNegotiationsForItem(
          itemId
        )
      await this.setCachedJson(
        cacheKey,
        activeNegotiationsCount,
        ACTIVE_NEGOTIATION_CACHE_TTL_SECONDS
      )

      return activeNegotiationsCount
    } catch (error) {
      this.homePerformanceService.recordActiveNegotiations({ errors: 1 })
      this.homePerformanceService.addDegraded(
        'activeNegotiations',
        'count_failed'
      )
      this.homePerformanceService.addFallback(
        'activeNegotiations',
        'count_as_zero'
      )
      this.logger.warn({
        event: 'catalog.home.degraded_component',
        component: 'activeNegotiations',
        reason: 'count_failed',
        err: error,
        itemId,
      })

      return 0
    } finally {
      this.homePerformanceService.addDuration(
        'activeNegotiations',
        Date.now() - startedAt
      )
    }
  }

  private async getCachedActiveNegotiationsCounts(itemIds: string[]) {
    const startedAt = Date.now()
    const uniqueItemIds = [...new Set(itemIds.filter(Boolean))]
    const countsByItemId = new Map<string, number>()
    const missingItemIds: string[] = []
    const cacheKeysByItemId = new Map(
      uniqueItemIds.map(itemId => [
        itemId,
        `catalog:item:${itemId}:active-negotiations`,
      ])
    )

    this.homePerformanceService.recordActiveNegotiations({
      requested: uniqueItemIds.length,
    })

    try {
      const cachedCounts = await this.getCachedJsonMap<number>(
        Array.from(cacheKeysByItemId.values())
      )

      for (const itemId of uniqueItemIds) {
        const cachedCount = cachedCounts.get(
          cacheKeysByItemId.get(itemId) as string
        )

        if (typeof cachedCount === 'number') {
          countsByItemId.set(itemId, cachedCount)
          continue
        }

        missingItemIds.push(itemId)
      }
      this.homePerformanceService.recordActiveNegotiations({
        cacheHits: uniqueItemIds.length - missingItemIds.length,
        cacheMisses: missingItemIds.length,
      })

      if (!missingItemIds.length) {
        return countsByItemId
      }

      const freshCounts =
        await this.negotiationPolicyService.countActiveNegotiationsForItems(
          missingItemIds
        )

      await this.setCachedJsonMap(
        missingItemIds.map(itemId => {
          const count = freshCounts.get(itemId) ?? 0
          countsByItemId.set(itemId, count)
          return {
            key: cacheKeysByItemId.get(itemId) as string,
            value: count,
          }
        }),
        ACTIVE_NEGOTIATION_CACHE_TTL_SECONDS
      )

      return countsByItemId
    } catch (error) {
      this.homePerformanceService.recordActiveNegotiations({
        errors: missingItemIds.length || uniqueItemIds.length,
      })
      this.homePerformanceService.addDegraded(
        'activeNegotiations',
        'batch_count_failed'
      )
      this.homePerformanceService.addFallback(
        'activeNegotiations',
        'batch_counts_as_zero'
      )
      this.logger.warn({
        event: 'catalog.home.degraded_component',
        component: 'activeNegotiations',
        reason: 'batch_count_failed',
        err: error,
        itemsCount: uniqueItemIds.length,
        missingItemsCount: missingItemIds.length,
      })

      for (const itemId of missingItemIds) {
        countsByItemId.set(itemId, 0)
      }

      return countsByItemId
    } finally {
      this.homePerformanceService.addDuration(
        'activeNegotiations',
        Date.now() - startedAt
      )
    }
  }

  async invalidateItemFeedCaches(itemId: string, ownerUserId?: string) {
    await this.catalogOutboxService.emitItemChanged({
      itemId,
      ownerUserId,
    })
  }

  async invalidateOwnerRankingCaches(ownerUserId: string) {
    await this.catalogOutboxService.emitOwnerRatingChanged(ownerUserId)
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

    const ownerSummariesResult = await this.getCachedOwnerSummaries(
      [item.ownerUserId],
      actor
    )

    if (ownerSummariesResult.hiddenUserIds.has(item.ownerUserId)) {
      throw new NotFoundException('Catalog item not found')
    }

    const serializedItem = await this.serializeItem(item, {
      includeOwnerModerationReport: isOwner,
      ownerSummary: ownerSummariesResult.summaries.get(item.ownerUserId) ?? null,
    })
    const rankingSignalsByOwner = await this.buildCatalogOwnerRankingSignals([
      serializedItem,
    ], ownerSummariesResult.summaries)

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
    const manualReviewNotes =
      publicationStatus === CatalogItemPublicationStatus.ACTIVE
        ? 'Aprobacion manual desde admin.'
        : publicationStatus === CatalogItemPublicationStatus.BLOCKED
          ? 'Bloqueo manual desde admin.'
          : null

    if (publicationStatus === CatalogItemPublicationStatus.ACTIVE) {
      await this.prismaService.catalogItemImageModeration.updateMany({
        where: {
          catalogItemId: itemId,
          status: {
            in: [
              CatalogImageModerationStatus.PENDING,
              CatalogImageModerationStatus.NEEDS_REVIEW,
              CatalogImageModerationStatus.ERROR,
              CatalogImageModerationStatus.BLOCKED,
            ],
          },
        },
        data: {
          status: CatalogImageModerationStatus.APPROVED,
          reviewedAt: new Date(),
          reviewNotes: manualReviewNotes,
        },
      })

      await this.catalogPublicationModerationService.clearPublicationReviewState(
        itemId,
      )
    }

    if (publicationStatus === CatalogItemPublicationStatus.BLOCKED) {
      await this.prismaService.catalogItemImageModeration.updateMany({
        where: {
          catalogItemId: itemId,
          status: {
            in: [
              CatalogImageModerationStatus.PENDING,
              CatalogImageModerationStatus.NEEDS_REVIEW,
              CatalogImageModerationStatus.ERROR,
            ],
          },
        },
        data: {
          status: CatalogImageModerationStatus.BLOCKED,
          reviewedAt: new Date(),
          reviewNotes: manualReviewNotes,
        },
      })

      await this.catalogPublicationModerationService.clearPublicationReviewState(
        itemId,
      )
    }

    const item = await this.prismaService.catalogItem.update({
      where: {
        id: itemId,
      },
      data: {
        publicationStatus: publicationStatus as never,
        ...(publicationStatus === CatalogItemPublicationStatus.ACTIVE
          ? { ownerModerationReport: Prisma.JsonNull }
          : {}),
        ...(shouldPublishNow ? { publishedAt: new Date() } : {}),
      },
      include: itemDetailInclude,
    })

    await this.catalogPublicationModerationService.emitOwnerNotification(
      existingItem,
      item,
      publicationStatus,
    )

    await this.invalidateItemFeedCaches(item.id, item.ownerUserId)

    return this.serializeItem(item, { includeOwnerModerationReport: true })
  }

  async adminDeleteItem(itemId: string, reason?: string) {
    const existingItem = await this.prismaService.catalogItem.findUnique({
      where: {
        id: itemId,
      },
      select: {
        id: true,
        ownerUserId: true,
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

    await this.invalidateItemFeedCaches(itemId, existingItem.ownerUserId)

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
        ownerUserId: true,
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
      await this.invalidateItemFeedCaches(itemId, item.ownerUserId)
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

    await this.invalidateItemFeedCaches(itemId, item.ownerUserId)
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
      ownerSummary?: IdentityOwnerSummary | null
      activeNegotiationsCount?: number
    }
  ) {
    const startedAt = Date.now()

    try {
      const activeNegotiationsCount =
        options?.activeNegotiationsCount ??
        await this.getCachedActiveNegotiationsCount(item.id)

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
        ownerSummary: options?.ownerSummary
          ? {
              userId: options.ownerSummary.userId,
              displayName: options.ownerSummary.displayName,
              avatarUrl: options.ownerSummary.avatarUrl,
              isAvatarVerified: options.ownerSummary.isAvatarVerified,
              isFollowingByViewer: options.ownerSummary.isFollowingByViewer,
            }
          : null,
        ...(options?.includeOwnerModerationReport
          ? {
              ownerModerationReport: item.ownerModerationReport,
            }
          : {}),
        images: await Promise.all(
          item.images.map(image => this.serializeImage(image))
        ),
      }
    } finally {
      this.homePerformanceService.addDuration(
        'serialization',
        Date.now() - startedAt
      )
    }
  }

  private async buildCatalogOwnerRankingSignals(items: {
    ownerUserId: string
    publishedAt?: Date | string | null
    createdAt: Date | string
    activeNegotiationsCount?: number
  }[],
  ownerSummaries?: Map<string, IdentityOwnerSummary>) {
    const uniqueOwnerUserIds = [...new Set(items.map(item => item.ownerUserId))]

    if (uniqueOwnerUserIds.length === 0) {
      return new Map<string, CatalogOwnerRankingSignals>()
    }

    const ownerRatingsMap = await this.getCachedOwnerRatings(uniqueOwnerUserIds)

    const rankingSignalsByOwner = new Map<string, CatalogOwnerRankingSignals>()

    for (const ownerUserId of uniqueOwnerUserIds) {
      const ownerSummary = ownerSummaries?.get(ownerUserId)
      const ownerRatings = ownerRatingsMap.get(ownerUserId)
      const ownerRepresentativeItem =
        items.find(item => item.ownerUserId === ownerUserId) ?? null
      const score = this.calculateCatalogOwnerRankingScore({
        ownerIsPremium: Boolean(ownerSummary?.isPremium),
        ownerAverageRating: ownerRatings?.averageRating ?? null,
        ownerRatingCount: ownerRatings?.ratingCount ?? 0,
        ownerFollowedByViewer:
          ownerSummary?.isFollowingByViewer ?? false,
        activeNegotiationsCount:
          ownerRepresentativeItem?.activeNegotiationsCount ?? 0,
        publishedAt:
          ownerRepresentativeItem?.publishedAt ??
          ownerRepresentativeItem?.createdAt ??
          null,
      })

      rankingSignalsByOwner.set(ownerUserId, {
        ownerIsPremium: Boolean(ownerSummary?.isPremium),
        ownerAverageRating: ownerRatings?.averageRating ?? null,
        ownerRatingCount: ownerRatings?.ratingCount ?? 0,
        ownerFollowedByViewer:
          ownerSummary?.isFollowingByViewer ?? false,
        score,
      })
    }

    return rankingSignalsByOwner
  }

  private buildFallbackRankingSignals(item: {
    publishedAt?: Date | string | null
    createdAt: Date | string
    activeNegotiationsCount: number
    ownerSummary?: {
      isFollowingByViewer?: boolean
    } | null
  }): CatalogOwnerRankingSignals {
    return {
      ownerIsPremium: false,
      ownerAverageRating: null,
      ownerRatingCount: 0,
      ownerFollowedByViewer: Boolean(item.ownerSummary?.isFollowingByViewer),
      score: this.calculateCatalogOwnerRankingScore({
        ownerIsPremium: false,
        ownerAverageRating: null,
        ownerRatingCount: 0,
        ownerFollowedByViewer: Boolean(item.ownerSummary?.isFollowingByViewer),
        activeNegotiationsCount: item.activeNegotiationsCount,
        publishedAt: item.publishedAt ?? item.createdAt,
      }),
    }
  }

  private calculateCatalogOwnerRankingScore(input: {
    ownerIsPremium: boolean
    ownerAverageRating: number | null
    ownerRatingCount: number
    ownerFollowedByViewer: boolean
    activeNegotiationsCount: number
    publishedAt: Date | string | null
  }) {
    const premiumBoost = input.ownerIsPremium ? 1000 : 0
    const ratingBoost = (input.ownerAverageRating ?? 0) * 100
    const ratingVolumeBoost = Math.min(input.ownerRatingCount, 50) * 4
    const followingBoost = input.ownerFollowedByViewer ? 180 : 0
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
        followingBoost +
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
    const startedAt = Date.now()
    const thumbnailUrl = image.storagePath
      ? this.storageService.createCatalogItemImageThumbnailUrl(
          image.storagePath,
        )
      : null
    let readableStorageUrl = image.storageUrl

    if (image.storagePath) {
      try {
        readableStorageUrl = await this.withTimeout(
          'mediaUrls',
          this.getHomeTimeoutMs('mediaTimeoutMs'),
          this.getCachedCatalogImageReadUrl(image.storagePath)
        )
      } catch (error) {
        this.homePerformanceService.recordMedia({
          fallbacks: 1,
          errors: 1,
        })
        this.homePerformanceService.addDegraded(
          'mediaUrls',
          'signed_url_failed'
        )
        this.homePerformanceService.addFallback(
          'mediaUrls',
          'thumbnail_or_existing_storage_url'
        )
        this.logger.warn({
          event: 'catalog.home.degraded_component',
          component: 'mediaUrls',
          reason: 'signed_url_failed',
          err: error,
          imageId: image.id,
        })
        readableStorageUrl = thumbnailUrl ?? image.storageUrl
      } finally {
        this.homePerformanceService.addDuration(
          'mediaUrls',
          Date.now() - startedAt
        )
      }
    }

    return {
      id: image.id,
      storageUrl: readableStorageUrl,
      thumbnailUrl,
      storagePath: image.storagePath,
      sortOrder: image.sortOrder,
      isCover: image.isCover,
      createdAt: image.createdAt,
    }
  }

  private async getCachedCatalogImageReadUrl(storagePath: string) {
    const cacheKey = `catalog:media-read-url:${this.hashJson(storagePath)}`
    this.homePerformanceService.recordMedia({ urlsRequested: 1 })
    const cachedUrl = await this.getCachedJson<string>(cacheKey)

    if (cachedUrl) {
      this.homePerformanceService.recordMedia({ cacheHits: 1 })
      return cachedUrl
    }

    const readableStorageUrl = await this.circuitBreakerService.execute(
      'media-signing',
      () => this.storageService.createCatalogItemImageReadUrl(storagePath)
    )
    this.homePerformanceService.recordMedia({ generated: 1 })
    await this.setCachedJson(
      cacheKey,
      readableStorageUrl,
      MEDIA_READ_URL_CACHE_TTL_SECONDS
    )

    return readableStorageUrl
  }
}
