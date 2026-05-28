import { Injectable, NotFoundException } from '@nestjs/common'
import { QueueService } from '../../queue/queue.service'
import { AdminQueueQueryDto } from '../dto/admin-queue-query.dto'

const DEFAULT_JOB_STATES = [
  'waiting',
  'active',
  'delayed',
  'failed',
  'completed',
  'paused',
]

@Injectable()
export class CatalogAdminQueueService {
  constructor(private readonly queueService: QueueService) {}

  async getSnapshot(query: AdminQueueQueryDto) {
    const queue = this.queueService.getSystemQueue()
    await queue.waitUntilReady()
    const take = query.take ?? 50
    const states = this.resolveStates(query.state)
    const [counts, isPaused, jobs] = await Promise.all([
      queue.getJobCounts(
        'active',
        'completed',
        'delayed',
        'failed',
        'paused',
        'prioritized',
        'waiting',
        'waiting-children',
      ),
      queue.isPaused(),
      queue.getJobs(states as never[], 0, take - 1, true),
    ])

    return {
      queue: queue.name,
      isPaused,
      counts,
      jobs: jobs.map((job) => this.serializeJob(job)),
    }
  }

  async pause() {
    const queue = this.queueService.getSystemQueue()
    await queue.pause()
    return this.getSnapshot({})
  }

  async resume() {
    const queue = this.queueService.getSystemQueue()
    await queue.resume()
    return this.getSnapshot({})
  }

  async retry(jobId: string) {
    const queue = this.queueService.getSystemQueue()
    const job = await queue.getJob(jobId)

    if (!job) {
      throw new NotFoundException('Queue job not found')
    }

    await job.retry('failed')
    return this.serializeJob(job)
  }

  private resolveStates(state?: string) {
    if (!state?.trim() || state === 'all') {
      return DEFAULT_JOB_STATES
    }

    return state
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }

  private serializeJob(job: any) {
    return {
      id: String(job.id),
      name: job.name,
      data: job.data,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason ?? null,
      stacktrace: job.stacktrace ?? [],
      progress: job.progress,
      returnvalue: job.returnvalue ?? null,
      timestamp: job.timestamp,
      processedOn: job.processedOn ?? null,
      finishedOn: job.finishedOn ?? null,
      opts: job.opts,
    }
  }
}
