import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PUBLICATION_MODERATION_QUEUE, SYSTEM_QUEUE } from './queue.constants';

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  constructor(
    @InjectQueue(SYSTEM_QUEUE) private readonly systemQueue: Queue,
    @InjectQueue(PUBLICATION_MODERATION_QUEUE)
    private readonly publicationModerationQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await Promise.all([
        this.systemQueue.waitUntilReady(),
        this.publicationModerationQueue.waitUntilReady(),
      ]);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown BullMQ connection error';

      throw new Error(`BullMQ is unavailable. ${message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.systemQueue.close(),
      this.publicationModerationQueue.close(),
    ]);
  }

  async ping() {
    await Promise.all([
      this.systemQueue.waitUntilReady(),
      this.publicationModerationQueue.waitUntilReady(),
    ]);

    const [
      systemCounts,
      publicationModerationCounts,
      systemPaused,
      publicationModerationPaused,
    ] = await Promise.all([
      this.systemQueue.getJobCounts(
        'active',
        'completed',
        'delayed',
        'failed',
        'paused',
        'prioritized',
        'waiting',
        'waiting-children',
      ),
      this.publicationModerationQueue.getJobCounts(
        'active',
        'completed',
        'delayed',
        'failed',
        'paused',
        'prioritized',
        'waiting',
        'waiting-children',
      ),
      this.systemQueue.isPaused(),
      this.publicationModerationQueue.isPaused(),
    ]);

    return {
      system: {
        queue: this.systemQueue.name,
        isPaused: systemPaused,
        counts: systemCounts,
      },
      publicationModeration: {
        queue: this.publicationModerationQueue.name,
        isPaused: publicationModerationPaused,
        counts: publicationModerationCounts,
      },
    };
  }

  getSystemQueue(): Queue {
    return this.systemQueue;
  }

  getPublicationModerationQueue(): Queue {
    return this.publicationModerationQueue;
  }
}
