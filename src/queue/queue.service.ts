import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SYSTEM_QUEUE } from './queue.constants';

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  constructor(@InjectQueue(SYSTEM_QUEUE) private readonly systemQueue: Queue) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.systemQueue.waitUntilReady();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown BullMQ connection error';

      throw new Error(`BullMQ is unavailable. ${message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.systemQueue.close();
  }

  async ping() {
    await this.systemQueue.waitUntilReady();

    return this.systemQueue.getJobCounts(
      'active',
      'completed',
      'delayed',
      'failed',
      'paused',
      'prioritized',
      'waiting',
      'waiting-children',
    );
  }

  getSystemQueue(): Queue {
    return this.systemQueue;
  }
}
