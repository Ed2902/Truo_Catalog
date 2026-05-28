import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SYSTEM_QUEUE } from '../../queue/queue.constants';
import {
  CATALOG_IMAGE_MODERATION_JOB,
  CATALOG_TEXT_MODERATION_JOB,
} from './catalog-publication-moderation.constants';
import { CatalogPublicationModerationService } from './catalog-publication-moderation.service';

@Processor(SYSTEM_QUEUE)
export class CatalogPublicationModerationProcessor extends WorkerHost {
  constructor(
    private readonly catalogPublicationModerationService: CatalogPublicationModerationService,
  ) {
    super();
  }

  async process(job: Job) {
    const maxAttempts =
      typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
    const jobContext = {
      attemptsMade: job.attemptsMade,
      maxAttempts,
    };

    try {
      switch (job.name) {
        case CATALOG_TEXT_MODERATION_JOB:
          return this.catalogPublicationModerationService.processQueuedTextModeration(
            job.data as {
              itemId: string;
              userId: string;
              text: string;
              version: string;
            },
            jobContext,
          );
        case CATALOG_IMAGE_MODERATION_JOB:
          return this.catalogPublicationModerationService.processQueuedImageModeration(
            job.data as {
              itemId: string;
              imageId: string;
              storageKey: string;
              version: string;
            },
            jobContext,
          );
        default:
          return;
      }
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw new UnrecoverableError(error.message);
      }

      throw error;
    }
  }
}
