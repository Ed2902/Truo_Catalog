import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { SYSTEM_QUEUE } from '../../queue/queue.constants';
import { CATALOG_OUTBOX_DISPATCH_JOB } from './catalog-outbox.constants';
import { CatalogOutboxService } from './catalog-outbox.service';

@Processor(SYSTEM_QUEUE)
export class CatalogOutboxProcessor extends WorkerHost {
  constructor(private readonly catalogOutboxService: CatalogOutboxService) {
    super();
  }

  async process(job: Job) {
    if (job.name !== CATALOG_OUTBOX_DISPATCH_JOB) {
      throw new UnrecoverableError(`Unsupported outbox job: ${job.name}`);
    }

    const eventId =
      job.data && typeof job.data.eventId === 'string'
        ? job.data.eventId
        : null;

    if (eventId) {
      await this.catalogOutboxService.processEvent(eventId);
      return;
    }

    await this.catalogOutboxService.processPendingEvents();
  }
}
