import { AsyncLocalStorage } from 'async_hooks';
import { Injectable } from '@nestjs/common';

type HomeComponent =
  | 'total'
  | 'marketplace'
  | 'categories'
  | 'pendingItems'
  | 'stories'
  | 'storiesApi'
  | 'identityOwnerSummaries'
  | 'ratings'
  | 'mediaUrls'
  | 'redisRead'
  | 'redisWrite'
  | 'activeNegotiations'
  | 'serialization'
  | 'snapshotBuild';

type ComponentEvent = {
  component: string;
  reason: string;
  durationMs?: number;
  timeoutMs?: number;
};

type HomePerformanceContext = {
  componentDurationsMs: Partial<Record<HomeComponent, number>>;
  degradedComponents: ComponentEvent[];
  fallbacksUsed: ComponentEvent[];
  timeouts: ComponentEvent[];
  redisCacheStats: {
    reads: number;
    writes: number;
    hits: number;
    misses: number;
    errors: number;
  };
  ratingsStats: {
    ownersRequested: number;
    cacheHits: number;
    cacheMisses: number;
    fallbackOwners: number;
  };
  mediaStats: {
    urlsRequested: number;
    cacheHits: number;
    generated: number;
    fallbacks: number;
    errors: number;
  };
  activeNegotiationsStats: {
    requested: number;
    cacheHits: number;
    cacheMisses: number;
    errors: number;
  };
};

const HOME_LATENCY_SAMPLE_LIMIT = 500;

@Injectable()
export class HomePerformanceService {
  private readonly storage = new AsyncLocalStorage<HomePerformanceContext>();
  private readonly homeLatencySamples: number[] = [];

  run<T>(operation: () => Promise<T>): Promise<T> {
    return this.storage.run(this.createContext(), operation);
  }

  getSummary() {
    const context = this.storage.getStore() ?? this.createContext();
    const latency = this.getLatencyPercentiles();

    return {
      componentDurationsMs: context.componentDurationsMs,
      degradedComponents: context.degradedComponents,
      fallbacksUsed: context.fallbacksUsed,
      timeouts: context.timeouts,
      redisCacheStats: context.redisCacheStats,
      ratingsStats: context.ratingsStats,
      mediaStats: context.mediaStats,
      activeNegotiationsStats: context.activeNegotiationsStats,
      p95Ms: latency.p95Ms,
      p99Ms: latency.p99Ms,
    };
  }

  observeHomeLatency(durationMs: number) {
    this.homeLatencySamples.push(durationMs);

    if (this.homeLatencySamples.length > HOME_LATENCY_SAMPLE_LIMIT) {
      this.homeLatencySamples.shift();
    }
  }

  addDuration(component: HomeComponent, durationMs: number) {
    const context = this.storage.getStore();

    if (!context) {
      return;
    }

    context.componentDurationsMs[component] =
      (context.componentDurationsMs[component] ?? 0) + durationMs;
  }

  addDegraded(component: string, reason: string, durationMs?: number) {
    const context = this.storage.getStore();

    if (!context) {
      return;
    }

    context.degradedComponents.push({ component, reason, durationMs });
  }

  addFallback(component: string, reason: string, durationMs?: number) {
    const context = this.storage.getStore();

    if (!context) {
      return;
    }

    context.fallbacksUsed.push({ component, reason, durationMs });
  }

  addTimeout(component: string, timeoutMs: number, reason = 'timeout') {
    const context = this.storage.getStore();

    if (!context) {
      return;
    }

    context.timeouts.push({ component, reason, timeoutMs });
  }

  recordRedisRead(input: {
    durationMs: number;
    hit?: boolean;
    error?: boolean;
  }) {
    const context = this.storage.getStore();

    if (!context) {
      return;
    }

    this.addDuration('redisRead', input.durationMs);
    context.redisCacheStats.reads += 1;

    if (input.error) {
      context.redisCacheStats.errors += 1;
      return;
    }

    if (input.hit) {
      context.redisCacheStats.hits += 1;
    } else {
      context.redisCacheStats.misses += 1;
    }
  }

  recordRedisWrite(input: { durationMs: number; error?: boolean }) {
    const context = this.storage.getStore();

    if (!context) {
      return;
    }

    this.addDuration('redisWrite', input.durationMs);
    context.redisCacheStats.writes += 1;

    if (input.error) {
      context.redisCacheStats.errors += 1;
    }
  }

  recordRatings(input: Partial<HomePerformanceContext['ratingsStats']>) {
    const context = this.storage.getStore();

    if (!context) {
      return;
    }

    for (const [key, value] of Object.entries(input)) {
      context.ratingsStats[key as keyof typeof context.ratingsStats] +=
        value ?? 0;
    }
  }

  recordMedia(input: Partial<HomePerformanceContext['mediaStats']>) {
    const context = this.storage.getStore();

    if (!context) {
      return;
    }

    for (const [key, value] of Object.entries(input)) {
      context.mediaStats[key as keyof typeof context.mediaStats] += value ?? 0;
    }
  }

  recordActiveNegotiations(
    input: Partial<HomePerformanceContext['activeNegotiationsStats']>,
  ) {
    const context = this.storage.getStore();

    if (!context) {
      return;
    }

    for (const [key, value] of Object.entries(input)) {
      context.activeNegotiationsStats[
        key as keyof typeof context.activeNegotiationsStats
      ] += value ?? 0;
    }
  }

  private getLatencyPercentiles() {
    if (!this.homeLatencySamples.length) {
      return {
        p95Ms: 0,
        p99Ms: 0,
      };
    }

    const sorted = [...this.homeLatencySamples].sort((left, right) => left - right);

    return {
      p95Ms: this.percentile(sorted, 0.95),
      p99Ms: this.percentile(sorted, 0.99),
    };
  }

  private percentile(sortedValues: number[], percentile: number) {
    const index = Math.min(
      sortedValues.length - 1,
      Math.ceil(sortedValues.length * percentile) - 1,
    );

    return sortedValues[index] ?? 0;
  }

  private createContext(): HomePerformanceContext {
    return {
      componentDurationsMs: {},
      degradedComponents: [],
      fallbacksUsed: [],
      timeouts: [],
      redisCacheStats: {
        reads: 0,
        writes: 0,
        hits: 0,
        misses: 0,
        errors: 0,
      },
      ratingsStats: {
        ownersRequested: 0,
        cacheHits: 0,
        cacheMisses: 0,
        fallbackOwners: 0,
      },
      mediaStats: {
        urlsRequested: 0,
        cacheHits: 0,
        generated: 0,
        fallbacks: 0,
        errors: 0,
      },
      activeNegotiationsStats: {
        requested: 0,
        cacheHits: 0,
        cacheMisses: 0,
        errors: 0,
      },
    };
  }
}
