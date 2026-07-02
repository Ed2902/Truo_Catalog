import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { CatalogOutboxEventStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { RedisService } from '../../redis/redis.service';
import {
  CATALOG_OUTBOX_BATCH_SIZE,
  CATALOG_OUTBOX_DISPATCH_JOB,
  CATALOG_OUTBOX_MAX_ATTEMPTS,
  CATALOG_OUTBOX_SWEEP_INTERVAL_MS,
  CATALOG_OUTBOX_TOPICS,
} from './catalog-outbox.constants';

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

type CatalogOutboxPayload = Prisma.InputJsonObject;

@Injectable()
export class CatalogOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CatalogOutboxService.name);
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly queueService: QueueService,
    private readonly redisService: RedisService,
  ) {}

  onModuleInit() {
    this.sweepTimer = setInterval(
      () =>
        void this.processPendingEvents().catch((error) => {
          this.logger.warn({ err: error }, 'Catalog outbox sweep failed');
        }),
      CATALOG_OUTBOX_SWEEP_INTERVAL_MS,
    );
    this.sweepTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
  }

  async emit(input: {
    topic: string;
    aggregateType?: string;
    aggregateId?: string;
    payload: CatalogOutboxPayload;
    maxAttempts?: number;
    prismaClient?: PrismaClientLike;
  }) {
    const prismaClient = input.prismaClient ?? this.prismaService;
    const event = await prismaClient.catalogOutboxEvent.create({
      data: {
        topic: input.topic,
        aggregateType: input.aggregateType ?? null,
        aggregateId: input.aggregateId ?? null,
        payload: input.payload,
        maxAttempts: input.maxAttempts ?? CATALOG_OUTBOX_MAX_ATTEMPTS,
      },
      select: {
        id: true,
      },
    });

    await this.scheduleDispatch(event.id);

    return event;
  }

  async emitItemChanged(input: { itemId: string; ownerUserId?: string | null }) {
    return this.emit({
      topic: CATALOG_OUTBOX_TOPICS.ITEM_CHANGED,
      aggregateType: 'catalogItem',
      aggregateId: input.itemId,
      payload: {
        itemId: input.itemId,
        ownerUserId: input.ownerUserId ?? null,
      },
    });
  }

  async emitProposalChanged(input: { itemIds: string[] }) {
    const itemIds = [...new Set(input.itemIds.filter(Boolean))];

    if (!itemIds.length) {
      return null;
    }

    return this.emit({
      topic: CATALOG_OUTBOX_TOPICS.PROPOSAL_CHANGED,
      aggregateType: 'exchangeProposal',
      aggregateId: itemIds.join(','),
      payload: {
        itemIds,
      },
    });
  }

  async emitOwnerRatingChanged(ownerUserId: string) {
    return this.emit({
      topic: CATALOG_OUTBOX_TOPICS.OWNER_RATING_CHANGED,
      aggregateType: 'user',
      aggregateId: ownerUserId,
      payload: {
        ownerUserId,
      },
    });
  }

  async emitOwnerProfileChanged(input: {
    ownerUserId: string;
    reason: string;
  }) {
    return this.emit({
      topic: CATALOG_OUTBOX_TOPICS.OWNER_PROFILE_CHANGED,
      aggregateType: 'user',
      aggregateId: input.ownerUserId,
      payload: {
        ownerUserId: input.ownerUserId,
        reason: input.reason,
      },
    });
  }

  async emitViewerRelationshipChanged(input: {
    viewerUserId: string;
    ownerUserId?: string | null;
    reason: string;
    securitySensitive?: boolean;
  }) {
    return this.emit({
      topic: CATALOG_OUTBOX_TOPICS.VIEWER_RELATIONSHIP_CHANGED,
      aggregateType: 'userRelationship',
      aggregateId: input.viewerUserId,
      payload: {
        viewerUserId: input.viewerUserId,
        ownerUserId: input.ownerUserId ?? null,
        reason: input.reason,
        securitySensitive: Boolean(input.securitySensitive),
      },
    });
  }

  async emitStoryChanged(input: {
    ownerUserId?: string | null;
    viewerUserId?: string | null;
    reason: string;
  }) {
    return this.emit({
      topic: CATALOG_OUTBOX_TOPICS.STORY_CHANGED,
      aggregateType: 'story',
      aggregateId: input.ownerUserId ?? input.viewerUserId ?? undefined,
      payload: {
        ownerUserId: input.ownerUserId ?? null,
        viewerUserId: input.viewerUserId ?? null,
        reason: input.reason,
      },
    });
  }

  async emitMediaChanged(input: { storagePath: string; reason: string }) {
    return this.emit({
      topic: CATALOG_OUTBOX_TOPICS.MEDIA_CHANGED,
      aggregateType: 'media',
      aggregateId: input.storagePath,
      payload: {
        storagePath: input.storagePath,
        reason: input.reason,
      },
    });
  }

  async processPendingEvents(limit = CATALOG_OUTBOX_BATCH_SIZE) {
    const now = new Date();
    const events = await this.prismaService.catalogOutboxEvent.findMany({
      where: {
        status: CatalogOutboxEventStatus.PENDING,
        nextAttemptAt: {
          lte: now,
        },
      },
      orderBy: [{ createdAt: 'asc' }],
      take: limit,
    });

    for (const event of events) {
      const claimed = await this.prismaService.catalogOutboxEvent.updateMany({
        where: {
          id: event.id,
          status: CatalogOutboxEventStatus.PENDING,
        },
        data: {
          status: CatalogOutboxEventStatus.PROCESSING,
        },
      });

      if (claimed.count === 0) {
        continue;
      }

      await this.processEvent(event.id);
    }
  }

  async processEvent(eventId: string) {
    const event = await this.prismaService.catalogOutboxEvent.findUnique({
      where: {
        id: eventId,
      },
    });

    if (
      !event ||
      event.status === CatalogOutboxEventStatus.PROCESSED ||
      event.status === CatalogOutboxEventStatus.FAILED
    ) {
      return;
    }

    try {
      await this.applyEvent(event.topic, event.payload);
      await this.prismaService.catalogOutboxEvent.update({
        where: {
          id: event.id,
        },
        data: {
          status: CatalogOutboxEventStatus.PROCESSED,
          processedAt: new Date(),
          failedAt: null,
          lastError: null,
        },
      });
    } catch (error) {
      await this.markEventFailed(event, error);
      throw error;
    }
  }

  async trackHomeFeedSnapshot(
    snapshotKey: string,
    ownerUserIds: string[],
    viewerUserId?: string | null,
  ) {
    await this.trackHomeFeedKeys(
      'snapshot',
      snapshotKey,
      ownerUserIds,
      viewerUserId,
    );
  }

  async trackHomeFeedPage(
    pageKey: string,
    ownerUserIds: string[],
    viewerUserId?: string | null,
  ) {
    await this.trackHomeFeedKeys('page', pageKey, ownerUserIds, viewerUserId);
  }

  private async applyEvent(topic: string, payload: Prisma.JsonValue) {
    switch (topic) {
      case CATALOG_OUTBOX_TOPICS.ITEM_CHANGED:
        return this.invalidateItemChanged(payload);
      case CATALOG_OUTBOX_TOPICS.PROPOSAL_CHANGED:
        return this.invalidateProposalChanged(payload);
      case CATALOG_OUTBOX_TOPICS.OWNER_RATING_CHANGED:
        return this.invalidateOwnerRankingChanged(payload);
      case CATALOG_OUTBOX_TOPICS.OWNER_PROFILE_CHANGED:
        return this.invalidateOwnerProfileChanged(payload);
      case CATALOG_OUTBOX_TOPICS.VIEWER_RELATIONSHIP_CHANGED:
        return this.invalidateViewerRelationshipChanged(payload);
      case CATALOG_OUTBOX_TOPICS.STORY_CHANGED:
        return this.invalidateStoryChanged(payload);
      case CATALOG_OUTBOX_TOPICS.MEDIA_CHANGED:
        return this.invalidateMediaChanged(payload);
      default:
        this.logger.warn({ topic }, 'Ignoring unknown catalog outbox event');
    }
  }

  private async invalidateItemChanged(payload: Prisma.JsonValue) {
    const itemId = this.readString(payload, 'itemId');
    const payloadOwnerUserId = this.readString(payload, 'ownerUserId');

    if (!itemId) {
      return;
    }

    const ownerUserId =
      payloadOwnerUserId ?? (await this.resolveItemOwnerUserId(itemId));

    await Promise.all([
      this.redisService.deleteKeys([`catalog:item:${itemId}:active-negotiations`]),
      ownerUserId
        ? this.invalidateOwnerFeedCaches(ownerUserId, {
            ownerSummary: true,
          })
        : Promise.resolve(),
    ]);
  }

  private async invalidateProposalChanged(payload: Prisma.JsonValue) {
    const itemIds = this.readStringArray(payload, 'itemIds');
    const ownerUserIds = await this.resolveItemOwnerUserIds(itemIds);

    await Promise.all([
      this.redisService.deleteKeys(
        itemIds.map((itemId) => `catalog:item:${itemId}:active-negotiations`),
      ),
      ...ownerUserIds.map((ownerUserId) =>
        this.invalidateOwnerFeedCaches(ownerUserId),
      ),
    ]);
  }

  private async invalidateOwnerRankingChanged(payload: Prisma.JsonValue) {
    const ownerUserId = this.readString(payload, 'ownerUserId');

    if (!ownerUserId) {
      return;
    }

    await this.invalidateOwnerFeedCaches(ownerUserId, {
      ownerRating: true,
    });
  }

  private async invalidateOwnerProfileChanged(payload: Prisma.JsonValue) {
    const ownerUserId = this.readString(payload, 'ownerUserId');

    if (!ownerUserId) {
      return;
    }

    await this.invalidateOwnerFeedCaches(ownerUserId, {
      ownerSummary: true,
    });
  }

  private async invalidateViewerRelationshipChanged(payload: Prisma.JsonValue) {
    const viewerUserId = this.readString(payload, 'viewerUserId');
    const ownerUserId = this.readString(payload, 'ownerUserId');

    if (!viewerUserId) {
      return;
    }

    await Promise.all([
      this.invalidateViewerFeedCaches(viewerUserId),
      ownerUserId
        ? this.redisService.deleteKeys([
            `catalog:owner-summary:${viewerUserId}:${ownerUserId}`,
          ])
        : Promise.resolve(0),
      ownerUserId
        ? this.invalidateOwnerFeedCaches(ownerUserId, {
            ownerSummary: true,
          })
        : Promise.resolve(),
    ]);
  }

  private async invalidateStoryChanged(payload: Prisma.JsonValue) {
    const ownerUserId = this.readString(payload, 'ownerUserId');
    const viewerUserId = this.readString(payload, 'viewerUserId');

    await Promise.all([
      ownerUserId ? this.invalidateOwnerFeedCaches(ownerUserId) : Promise.resolve(),
      viewerUserId ? this.invalidateViewerFeedCaches(viewerUserId) : Promise.resolve(),
    ]);
  }

  private async invalidateMediaChanged(payload: Prisma.JsonValue) {
    const storagePath = this.readString(payload, 'storagePath');

    if (!storagePath) {
      return;
    }

    await this.redisService.deleteKeys([
      `catalog:media-read-url:${this.hashString(storagePath)}`,
      `catalog:storage:media-read-url:${this.hashString(storagePath)}`,
    ]);
  }

  private async invalidateOwnerFeedCaches(
    ownerUserId: string,
    options?: {
      ownerSummary?: boolean;
      ownerRating?: boolean;
    },
  ) {
    const snapshotIndexKey = this.buildFeedIndexKey('snapshot', ownerUserId);
    const pageIndexKey = this.buildFeedIndexKey('page', ownerUserId);
    const [snapshotKeys, pageKeys] = await Promise.all([
      this.redisService.getSetMembers(snapshotIndexKey),
      this.redisService.getSetMembers(pageIndexKey),
    ]);
    const keysToDelete = [
      ...snapshotKeys,
      ...pageKeys,
      snapshotIndexKey,
      pageIndexKey,
      ...(options?.ownerSummary
        ? [`catalog:owner-summary:*:${ownerUserId}`]
        : []),
      ...(options?.ownerRating ? [`catalog:owner-rating:${ownerUserId}`] : []),
    ];

    await Promise.all([
      this.redisService.deleteKeys(
        keysToDelete.filter((key) => !key.includes('*')),
      ),
      options?.ownerSummary
        ? this.redisService.deleteByPattern(`catalog:owner-summary:*:${ownerUserId}`)
        : Promise.resolve(0),
    ]);
  }

  private async invalidateViewerFeedCaches(viewerUserId: string) {
    const snapshotIndexKey = this.buildFeedViewerIndexKey(
      'snapshot',
      viewerUserId,
    );
    const pageIndexKey = this.buildFeedViewerIndexKey('page', viewerUserId);
    const [snapshotKeys, pageKeys] = await Promise.all([
      this.redisService.getSetMembers(snapshotIndexKey),
      this.redisService.getSetMembers(pageIndexKey),
    ]);

    await this.redisService.deleteKeys([
      ...snapshotKeys,
      ...pageKeys,
      snapshotIndexKey,
      pageIndexKey,
    ]);
  }

  private async trackHomeFeedKeys(
    kind: 'page' | 'snapshot',
    cacheKey: string,
    ownerUserIds: string[],
    viewerUserId?: string | null,
  ) {
    const uniqueOwnerUserIds = [...new Set(ownerUserIds.filter(Boolean))];

    await Promise.all([
      ...uniqueOwnerUserIds.map((ownerUserId) =>
        this.redisService.addSetMembers(
          this.buildFeedIndexKey(kind, ownerUserId),
          [cacheKey],
          180,
        ),
      ),
      viewerUserId
        ? this.redisService.addSetMembers(
            this.buildFeedViewerIndexKey(kind, viewerUserId),
            [cacheKey],
            180,
          )
        : Promise.resolve(),
    ]);
  }

  private buildFeedIndexKey(kind: 'page' | 'snapshot', ownerUserId: string) {
    return `catalog:home-feed:index:${kind}:owner:${ownerUserId}`;
  }

  private buildFeedViewerIndexKey(kind: 'page' | 'snapshot', viewerUserId: string) {
    return `catalog:home-feed:index:${kind}:viewer:${viewerUserId}`;
  }

  private hashString(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private async resolveItemOwnerUserId(itemId: string) {
    const item = await this.prismaService.catalogItem.findUnique({
      where: {
        id: itemId,
      },
      select: {
        ownerUserId: true,
      },
    });

    return item?.ownerUserId ?? null;
  }

  private async resolveItemOwnerUserIds(itemIds: string[]) {
    if (!itemIds.length) {
      return [];
    }

    const items = await this.prismaService.catalogItem.findMany({
      where: {
        id: {
          in: itemIds,
        },
      },
      select: {
        ownerUserId: true,
      },
    });

    return [...new Set(items.map((item) => item.ownerUserId))];
  }

  private async markEventFailed(
    event: {
      id: string;
      attempts: number;
      maxAttempts: number;
    },
    error: unknown,
  ) {
    const attempts = event.attempts + 1;
    const exhausted = attempts >= event.maxAttempts;
    const retryDelayMs = Math.min(60_000, 1000 * 2 ** Math.max(0, attempts - 1));

    await this.prismaService.catalogOutboxEvent.update({
      where: {
        id: event.id,
      },
      data: {
        attempts,
        status: exhausted
          ? CatalogOutboxEventStatus.FAILED
          : CatalogOutboxEventStatus.PENDING,
        failedAt: exhausted ? new Date() : null,
        nextAttemptAt: exhausted
          ? new Date()
          : new Date(Date.now() + retryDelayMs),
        lastError: error instanceof Error ? error.message : 'unknown_error',
      },
    });
  }

  private async scheduleDispatch(eventId: string) {
    try {
      await this.queueService.getSystemQueue().add(
        CATALOG_OUTBOX_DISPATCH_JOB,
        {
          eventId,
        },
        {
          jobId: `${CATALOG_OUTBOX_DISPATCH_JOB}:${eventId}`,
          attempts: 3,
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      );
    } catch (error) {
      this.logger.warn(
        { err: error, eventId },
        'Unable to enqueue catalog outbox dispatch; sweep will retry',
      );
    }
  }

  private readString(payload: Prisma.JsonValue, key: string) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }

    const value = payload[key];
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private readStringArray(payload: Prisma.JsonValue, key: string) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return [];
    }

    const value = payload[key];
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }
}
