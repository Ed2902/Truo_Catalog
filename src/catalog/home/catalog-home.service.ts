import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CatalogCategoriesService } from '../categories/catalog-categories.service';
import { ListCatalogItemsQueryDto } from '../dto/list-catalog-items-query.dto';
import { IdentityOwnerSummary, IdentitySignalsService } from '../identity/identity-signals.service';
import { CatalogActor } from '../interfaces/catalog-actor.interface';
import { CatalogItemsService } from '../items/catalog-items.service';
import { CatalogItemPublicationStatus } from '../shared/catalog.constants';
import { HomePerformanceService } from '../../common/observability/home-performance.service';
import { CircuitBreakerService } from '../../common/resilience/circuit-breaker.service';
import {
  CATALOG_ITEM_IMAGE_READ_URL_CACHE_TTL_SECONDS,
  CATALOG_ITEM_IMAGE_READ_URL_TTL_SECONDS,
  CATALOG_ITEM_IMAGE_UPLOAD_URL_TTL_SECONDS,
} from '../../storage/storage.service';

type Story = {
  id: string;
  ownerUserId: string;
  caption: string | null;
  status: string;
  mimeType: string;
  mediaUrl: string;
  viewCount: number;
  hasViewed: boolean;
  expiresAt: string;
  publishedAt: string | null;
  createdAt: string;
  moderation?: Record<string, unknown>;
};

type StoryFeedGroup = {
  ownerUserId: string;
  previewUrl: string;
  latestPublishedAt: string;
  hasUnviewed: boolean;
  storyCount: number;
  stories: Story[];
  ownerSummary?: ReturnType<CatalogHomeService['serializeOwnerSummary']> | null;
};

type TimedResult<T> = {
  value: T;
  durationMs: number;
};

type ObservableHomeMedia = {
  thumbnailUrl?: string | null;
  storageUrl?: string | null;
};

@Injectable()
export class CatalogHomeService {
  private readonly logger = new Logger(CatalogHomeService.name);

  constructor(
    private readonly catalogItemsService: CatalogItemsService,
    private readonly catalogCategoriesService: CatalogCategoriesService,
    private readonly identitySignalsService: IdentitySignalsService,
    private readonly configService: ConfigService,
    private readonly homePerformanceService: HomePerformanceService,
    private readonly circuitBreakerService: CircuitBreakerService,
  ) {}

  async getHomeSnapshot(input: {
    query: ListCatalogItemsQueryDto;
    actor?: CatalogActor;
    authorization?: string;
  }) {
    return this.homePerformanceService.run(() =>
      this.buildHomeSnapshot(input),
    );
  }

  private async buildHomeSnapshot(input: {
    query: ListCatalogItemsQueryDto;
    actor?: CatalogActor;
    authorization?: string;
  }) {
    const startedAt = Date.now();
    const actor = input.actor;
    const marketplaceQuery = {
      ...input.query,
      take: input.query.take ?? 16,
    };
    const [
      marketplace,
      categories,
      pendingItems,
      storiesSection,
    ] = await Promise.all([
      this.time(() =>
        this.catalogItemsService.getHomeFeed(marketplaceQuery, input.actor),
        'marketplace',
      ),
      this.time(
        () => this.catalogCategoriesService.listCategoriesTree(),
        'categories',
      ),
      actor
        ? this.time(() => this.listPendingItems(actor), 'pendingItems')
        : Promise.resolve({ value: [], durationMs: 0 }),
      this.time(() =>
        this.getStoriesSection(input.actor, input.authorization),
        'stories',
      ),
    ]);
    const { metrics: storiesMetrics, ...publicStoriesSection } =
      storiesSection.value;

    const snapshot = {
      generatedAt: new Date().toISOString(),
      viewer: {
        userId: input.actor?.userId ?? null,
      },
      categories: categories.value,
      pendingItems: pendingItems.value,
      stories: publicStoriesSection,
      marketplace: {
        cards: marketplace.value.items,
        pageInfo: marketplace.value.pageInfo,
        generatedAt: marketplace.value.generatedAt,
      },
      storagePolicy: this.buildStoragePolicy(),
    };
    const responseSizeBytes = Buffer.byteLength(JSON.stringify(snapshot));
    const marketplaceMedia = marketplace.value.items.flatMap((item) =>
      (item.images ?? []) as ObservableHomeMedia[],
    );
    const thumbnailUrlsCount = marketplaceMedia.filter(
      (image) => Boolean(image.thumbnailUrl),
    ).length;
    const signedMediaUrlsCount = marketplaceMedia.filter(
      (image) => Boolean(image.storageUrl),
    ).length;

    const durationMs = Date.now() - startedAt;
    this.homePerformanceService.addDuration('total', durationMs);
    this.homePerformanceService.observeHomeLatency(durationMs);
    const performanceMetrics = this.homePerformanceService.getSummary();
    const budget = this.resolvePerformanceBudget(durationMs);
    const logPayload = {
      event: 'catalog.home.snapshot',
      durationMs,
      responseSizeBytes,
      viewerUserId: input.actor?.userId ?? null,
      take: marketplaceQuery.take,
      hasCursor: Boolean(input.query.cursor),
      feedVersion: marketplace.value.pageInfo.feedVersion,
      cardsCount: marketplace.value.items.length,
      categoriesCount: categories.value.length,
      pendingItemsCount: pendingItems.value.length,
      storiesMyCount: publicStoriesSection.myStories.length,
      storiesGroupsCount: publicStoriesSection.feedGroups.length,
      thumbnailUrlsCount,
      signedMediaUrlsCount,
      degraded: publicStoriesSection.degraded,
      degradationReason: storiesMetrics.degradationReason,
      performanceBudget: budget,
      p95Ms: performanceMetrics.p95Ms,
      p99Ms: performanceMetrics.p99Ms,
      componentDurationsMs: {
        ...performanceMetrics.componentDurationsMs,
        marketplace: marketplace.durationMs,
        categories: categories.durationMs,
        pendingItems: pendingItems.durationMs,
        stories: storiesSection.durationMs,
        storiesApi: storiesMetrics.storiesApiDurationMs,
        identityOwnerSummaries: storiesMetrics.identityDurationMs,
      },
      degradedComponents: performanceMetrics.degradedComponents,
      fallbacksUsed: performanceMetrics.fallbacksUsed,
      timeouts: performanceMetrics.timeouts,
      redisCacheStats: performanceMetrics.redisCacheStats,
      ratingsStats: performanceMetrics.ratingsStats,
      mediaStats: performanceMetrics.mediaStats,
      activeNegotiationsStats: performanceMetrics.activeNegotiationsStats,
    };

    this.logger.log(logPayload);

    if (budget.level !== 'ok') {
      this.logger.warn({
        ...logPayload,
        event: 'catalog.home.performance_budget_exceeded',
      });
    }

    return snapshot;
  }

  private async listPendingItems(actor: CatalogActor) {
    const pendingStatuses = [
      CatalogItemPublicationStatus.UNDER_REVIEW,
      CatalogItemPublicationStatus.DRAFT,
      CatalogItemPublicationStatus.BLOCKED,
    ];
    const results = await Promise.all(
      pendingStatuses.map((publicationStatus) =>
        this.catalogItemsService.listMyItems(actor, {
          take: 10,
          publicationStatus,
        }),
      ),
    );
    const dedupedItems = new Map<string, Record<string, unknown>>();

    for (const items of results) {
      for (const item of items as Array<Record<string, unknown>>) {
        if (typeof item.id === 'string') {
          dedupedItems.set(item.id, item);
        }
      }
    }

    return Array.from(dedupedItems.values())
      .sort(
        (left, right) =>
          new Date(String(right.createdAt)).getTime() -
          new Date(String(left.createdAt)).getTime(),
      )
      .slice(0, 10);
  }

  private async getStoriesSection(
    actor?: CatalogActor,
    authorization?: string,
  ) {
    if (!actor || !authorization) {
      return {
        myStories: [],
        feedGroups: [],
        degraded: false,
        metrics: {
          storiesApiDurationMs: 0,
          identityDurationMs: 0,
          degradationReason: null,
        },
      };
    }

    try {
      const storiesApiStartedAt = Date.now();
      const [myStories, feedGroups] = await Promise.all([
        this.fetchStories<Story[]>('/stories/me', authorization, { take: 20 }),
        this.fetchStories<StoryFeedGroup[]>('/stories/feed', authorization, {
          take: 20,
        }),
      ]);
      const storiesApiDurationMs = Date.now() - storiesApiStartedAt;
      this.homePerformanceService.addDuration(
        'storiesApi',
        storiesApiDurationMs,
      );
      const identityStartedAt = Date.now();
      const ownerSummariesResult =
        await this.identitySignalsService.getOwnerSummaries(
          feedGroups.map((group) => group.ownerUserId),
          actor,
        );
      const identityDurationMs = Date.now() - identityStartedAt;
      this.homePerformanceService.addDuration(
        'identityOwnerSummaries',
        identityDurationMs,
      );
      if (ownerSummariesResult.degraded) {
        this.homePerformanceService.addDegraded(
          'identityOwnerSummaries',
          'owner_summaries_degraded',
          identityDurationMs,
        );
      }

      return {
        myStories,
        feedGroups: feedGroups
          .filter(
            (group) => !ownerSummariesResult.hiddenUserIds.has(group.ownerUserId),
          )
          .map((group) => ({
            ...group,
            ownerSummary: this.serializeOwnerSummary(
              ownerSummariesResult.summaries.get(group.ownerUserId) ?? null,
            ),
          })),
        degraded: Boolean(ownerSummariesResult.degraded),
        metrics: {
          storiesApiDurationMs,
          identityDurationMs,
          degradationReason: ownerSummariesResult.degraded ? 'identity' : null,
        },
      };
    } catch (error) {
      this.homePerformanceService.addDegraded('stories', 'stories_failed');
      this.logger.warn(
        { err: error, event: 'catalog.home.stories_degraded' },
        'Home stories section degraded',
      );

      return {
        myStories: [],
        feedGroups: [],
        degraded: true,
        metrics: {
          storiesApiDurationMs: 0,
          identityDurationMs: 0,
          degradationReason: 'stories',
        },
      };
    }
  }

  private async fetchStories<T>(
    path: string,
    authorization: string,
    query?: Record<string, string | number>,
  ): Promise<T> {
    const baseUrl = this.configService.get<string | undefined>('stories.baseUrl');

    if (!baseUrl) {
      return [] as T;
    }

    const url = new URL(`${baseUrl.replace(/\/+$/, '')}${path}`);

    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }

    const timeoutMs =
      this.configService.get<number | undefined>(
        'homePerformance.storiesTimeoutMs',
      ) ??
      this.configService.get<number | undefined>('stories.timeoutMs') ??
      1000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.circuitBreakerService.execute(
        'stories-api',
        () =>
          fetch(url, {
            headers: {
              Authorization: authorization,
            },
            signal: controller.signal,
          }),
      );

      if (!response.ok) {
        throw new Error(`Stories returned HTTP ${response.status}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.homePerformanceService.addTimeout('storiesApi', timeoutMs);
        this.logger.warn({
          event: 'catalog.home.component_timeout',
          component: 'storiesApi',
          timeoutMs,
          path,
        });
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private serializeOwnerSummary(summary: IdentityOwnerSummary | null) {
    if (!summary) {
      return null;
    }

    return {
      userId: summary.userId,
      displayName: summary.displayName,
      avatarUrl: summary.avatarUrl,
      isAvatarVerified: summary.isAvatarVerified,
      isFollowingByViewer: summary.isFollowingByViewer,
    };
  }

  private async time<T>(
    operation: () => Promise<T>,
    component?: Parameters<HomePerformanceService['addDuration']>[0],
  ): Promise<TimedResult<T>> {
    const startedAt = Date.now();
    const value = await operation();
    const durationMs = Date.now() - startedAt;

    if (component) {
      this.homePerformanceService.addDuration(component, durationMs);
    }

    return {
      value,
      durationMs,
    };
  }

  private resolvePerformanceBudget(durationMs: number) {
    const warnMs =
      this.configService.get<number | undefined>(
        'homePerformance.warnMs',
      ) ?? 800;
    const criticalMs =
      this.configService.get<number | undefined>(
        'homePerformance.criticalMs',
      ) ?? 1200;

    return {
      warnMs,
      criticalMs,
      level:
        durationMs >= criticalMs
          ? 'critical'
          : durationMs >= warnMs
            ? 'warn'
            : 'ok',
    };
  }

  private buildStoragePolicy() {
    return {
      signedUrlTtlSeconds: {
        catalogItemImageUpload: CATALOG_ITEM_IMAGE_UPLOAD_URL_TTL_SECONDS,
        catalogItemImageRead: CATALOG_ITEM_IMAGE_READ_URL_TTL_SECONDS,
        storyUpload: 5 * 60,
        storyRead: 60 * 60,
        avatarUpload: 5 * 60,
        avatarRead: 60 * 60 * 24,
      },
      serverCacheTtlSeconds: {
        signedMediaReadUrl: CATALOG_ITEM_IMAGE_READ_URL_CACHE_TTL_SECONDS,
      },
      serverCacheBackend: {
        signedMediaReadUrl: 'redis-distributed-with-local-fallback',
      },
      clientCacheGuidanceSeconds: {
        homeWall: 30,
        stories: 30,
        publicProfile: 10 * 60,
        followState: 45,
        restrictions: 30,
        myCatalogItems: 45,
        itemDetail: 2 * 60,
      },
      publicOrCdnReads: [
        'only for explicitly public derivatives or assets safe to expose globally',
        'must be emitted by API after business visibility decisions',
        'original media keeps using signed read URLs unless explicitly migrated',
      ],
      publicDerivativePresets: {
        catalogCard: {
          width: 640,
          height: 640,
          format: 'webp',
          quality: 75,
        },
        storyPreview: {
          width: 360,
          height: 640,
          format: 'webp',
          quality: 75,
        },
        avatar: {
          width: 160,
          height: 160,
          format: 'webp',
          quality: 75,
        },
      },
      directClientUpload: [
        'catalog.item.image',
        'story.media',
        'profile.avatar',
      ],
      apiMediatedReads: [
        'signed-read-url',
        'owner-filtered-feed-media',
      ],
      neverExposeToClient: [
        'storage.accessKey',
        'storage.secretKey',
        'raw-bucket-admin-credentials',
        'storageKey-for-unowned-object',
      ],
      rules: [
        'client uploads only with API-issued signed URLs',
        'API confirms ownership before binding storageKey to business data',
        'feeds return temporary readable media URLs, not storage credentials',
        'server reuses signed media URLs in Redis briefly to avoid signing every image on every request',
        'client refreshes API snapshots when media URLs expire instead of constructing storage paths',
        'client may prefer thumbnailUrl/avatarThumbnailUrl in list surfaces and fallback to signed originals',
      ],
    };
  }
}
