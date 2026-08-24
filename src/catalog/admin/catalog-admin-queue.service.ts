import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'
import { PrismaService } from '../../prisma/prisma.service'
import { QueueService } from '../../queue/queue.service'
import { AdminQueueQueryDto } from '../dto/admin-queue-query.dto'
import {
  CATALOG_IMAGE_MODERATION_JOB,
  CATALOG_TEXT_MODERATION_JOB,
} from '../moderation/catalog-publication-moderation.constants'
import { CATALOG_OUTBOX_DISPATCH_JOB } from '../outbox/catalog-outbox.constants'

const DEFAULT_JOB_STATES = [
  'waiting',
  'active',
  'delayed',
  'failed',
  'paused',
]

const TECHNICAL_JOB_STATES = [
  'waiting',
  'active',
  'delayed',
  'failed',
  'completed',
  'paused',
] as const

const CATALOG_QUEUE_KEYS = ['publicationModeration', 'system'] as const

type CatalogQueueKey = (typeof CATALOG_QUEUE_KEYS)[number]

type PublicationStateDetails = {
  textStatus: string
  pendingImages: number
  approvedImages: number
  reviewImages: number
  blockedImages: number
  errorImages: number
}

type PublicationOperation = {
  itemId: string
  title: string
  description: string
  exchangePreferences: string | null
  ownerUserId: string
  categoryName: string | null
  publicationStatus: string
  updatedAt: string
  createdAt: string
  queueName: string
  currentStage: string
  queueState: string
  pendingImages: number
  approvedImages: number
  blockedImages: number
  reviewImages: number
  errorImages: number
  textStatus: string
  jobsQueued: number
  failedJobs: number
  activeJobs: number
  waitingJobs: number
  isStalled: boolean
  reasons: string[]
  coverImageUrl: string | null
  imagePreviewUrls: string[]
  textPreview: string
  currentWorkerLabel: string
  failedWorkerLabel: string | null
  failedWorkerReason: string | null
  imageJobSummary: {
    total: number
    waiting: number
    active: number
    failed: number
    completed: number
  }
  textJobSummary: {
    state: string
    failed: boolean
    completed: boolean
  }
  startedAt: string
  lastActivityAt: string | null
  timeInFlowMs: number
  timeSinceLastActivityMs: number | null
  latestJobId: string | null
  failedJobId: string | null
  latestJobLabel: string | null
  latestJobState: string | null
  summary: string
  reference?: string
}

@Injectable()
export class CatalogAdminQueueService {
  constructor(
    private readonly queueService: QueueService,
    private readonly prismaService: PrismaService,
  ) {}

  async getSnapshot(query: AdminQueueQueryDto) {
    const queueKey = this.resolveQueueKey(query.queueKey)
    const take = query.take ?? 25
    const states = this.resolveStates(query.state)
    const queueDefinitions = this.getQueueDefinitions()

    const [selectedQueue, queueCards, operations] = await Promise.all([
      this.buildQueueSnapshot(queueKey, take, states, true),
      Promise.all(
        queueDefinitions.map((definition) =>
          this.buildQueueSnapshot(
            definition.key,
            definition.key === queueKey ? take : Math.min(take, 10),
            states,
            definition.key === queueKey,
          ),
        ),
      ),
      this.buildPublicationOperations(Math.max(take, 40)),
    ])

    return {
      queueKey: selectedQueue.key,
      queue: selectedQueue.queue,
      title: selectedQueue.title,
      description: selectedQueue.description,
      isPaused: selectedQueue.isPaused,
      counts: selectedQueue.counts,
      jobs: selectedQueue.jobs,
      queues: queueCards.map((card) => ({
        key: card.key,
        queue: card.queue,
        title: card.title,
        description: card.description,
        isPaused: card.isPaused,
        counts: card.counts,
        actionableCount: card.actionableCount,
        visibleJobs: card.jobs.length,
      })),
      operations,
      operationsSummary: {
        total: operations.length,
        stalled: operations.filter((operation) => operation.isStalled).length,
        failed: operations.filter((operation) => operation.failedJobs > 0).length,
        manualReview: operations.filter(
          (operation) => operation.currentStage === 'Revisión manual',
        ).length,
      },
    }
  }

  async pause(queueKey?: string) {
    const resolvedQueueKey = this.resolveQueueKey(queueKey)
    const queue = this.getQueueByKey(resolvedQueueKey)
    await queue.pause()
    return this.getSnapshot({ queueKey: resolvedQueueKey })
  }

  async resume(queueKey?: string) {
    const resolvedQueueKey = this.resolveQueueKey(queueKey)
    const queue = this.getQueueByKey(resolvedQueueKey)
    await queue.resume()
    return this.getSnapshot({ queueKey: resolvedQueueKey })
  }

  async retry(jobId: string, queueKey?: string) {
    const resolvedQueueKey = this.resolveQueueKey(queueKey)
    const queue = this.getQueueByKey(resolvedQueueKey)
    const job = await queue.getJob(jobId)

    if (!job) {
      throw new NotFoundException('Queue job not found')
    }

    const maxAttempts =
      typeof job.opts.attempts === 'number' ? job.opts.attempts : 1

    if (job.attemptsMade >= maxAttempts) {
      throw new BadRequestException('Queue job exhausted its retry limit')
    }

    await job.retry('failed')
    return this.serializeJob(job, resolvedQueueKey, 0, 'failed')
  }

  async remove(jobId: string, queueKey?: string) {
    const resolvedQueueKey = this.resolveQueueKey(queueKey)
    const queue = this.getQueueByKey(resolvedQueueKey)
    const job = await queue.getJob(jobId)

    if (!job) {
      throw new NotFoundException('Queue job not found')
    }

    const removed = await queue.remove(jobId)

    if (!removed) {
      throw new BadRequestException(
        'No se pudo eliminar el job porque sigue bloqueado o en procesamiento activo',
      )
    }

    return {
      removed: true,
      jobId,
      queueKey: resolvedQueueKey,
    }
  }

  private getQueueDefinitions() {
    return [
      {
        key: 'publicationModeration' as const,
        title: 'Moderación de publicaciones',
        description: 'Texto, imágenes y activación automática del producto.',
      },
      {
        key: 'system' as const,
        title: 'Outbox e integración',
        description: 'Eventos internos, barridos y sincronización técnica.',
      },
    ]
  }

  private getQueueByKey(queueKey: CatalogQueueKey) {
    return queueKey === 'publicationModeration'
      ? this.queueService.getPublicationModerationQueue()
      : this.queueService.getSystemQueue()
  }

  private async buildQueueSnapshot(
    queueKey: CatalogQueueKey,
    take: number,
    states: string[],
    includeJobs: boolean,
  ) {
    const queue = this.getQueueByKey(queueKey)
    const definition = this.getQueueDefinitions().find(
      (entry) => entry.key === queueKey,
    )

    await queue.waitUntilReady()

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
      includeJobs ? queue.getJobs(states as never[], 0, take - 1, true) : [],
    ])

    const serializedJobs = await this.serializeJobs(queueKey, jobs)

    return {
      key: queueKey,
      queue: queue.name,
      title: definition?.title ?? queueKey,
      description: definition?.description ?? '',
      isPaused,
      counts,
      actionableCount:
        Number(counts.active ?? 0) +
        Number(counts.waiting ?? 0) +
        Number(counts.delayed ?? 0) +
        Number(counts.failed ?? 0),
      jobs: serializedJobs,
    }
  }

  private async serializeJobs(queueKey: CatalogQueueKey, jobs: Job[]) {
    if (!jobs.length) {
      return []
    }

    const jobStates = await Promise.all(
      jobs.map((job) => job.getState().catch(() => 'unknown')),
    )

    const itemIds = Array.from(
      new Set(
        jobs
          .map((job) =>
            job.data && typeof job.data.itemId === 'string' ? job.data.itemId : null,
          )
          .filter((value): value is string => Boolean(value)),
      ),
    )

    const catalogItems = itemIds.length
      ? await this.prismaService.catalogItem.findMany({
          where: {
            id: {
              in: itemIds,
            },
          },
          select: {
            id: true,
            title: true,
            publicationStatus: true,
            ownerUserId: true,
            category: {
              select: {
                name: true,
              },
            },
          },
        })
      : []

    const itemMap = new Map(catalogItems.map((item) => [item.id, item]))

    return Promise.all(
      jobs.map((job, index) =>
        this.serializeJob(job, queueKey, index, jobStates[index], itemMap),
      ),
    )
  }

  private async serializeJob(
    job: Job,
    queueKey: CatalogQueueKey,
    index: number,
    jobState: string,
    itemMap = new Map<
      string,
      {
        id: string
        title: string
        publicationStatus: string
        ownerUserId: string
        category: { name: string } | null
      }
    >(),
  ) {
    const itemId =
      job.data && typeof job.data.itemId === 'string' ? job.data.itemId : null
    const item = itemId ? itemMap.get(itemId) ?? null : null

    return {
      id: String(job.id),
      reference: `${queueKey === 'publicationModeration' ? 'MOD' : 'SYS'}-${String(
        index + 1,
      ).padStart(3, '0')}`,
      name: job.name,
      label: this.resolveJobLabel(job.name),
      state: jobState,
      queueKey,
      itemId,
      itemTitle: item?.title ?? null,
      itemOwnerUserId: item?.ownerUserId ?? null,
      itemCategory: item?.category?.name ?? null,
      itemPublicationStatus: item?.publicationStatus ?? null,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason ?? null,
      stacktrace: job.stacktrace ?? [],
      progress: job.progress,
      returnvalue: job.returnvalue ?? null,
      timestamp: job.timestamp,
      processedOn: job.processedOn ?? null,
      finishedOn: job.finishedOn ?? null,
      data: job.data,
      summary: this.resolveJobSummary(job, item),
      opts: job.opts,
    }
  }

  private async buildPublicationOperations(limit: number): Promise<PublicationOperation[]> {
    const queue = this.queueService.getPublicationModerationQueue()
    await queue.waitUntilReady()

    const jobs = await queue.getJobs(
      TECHNICAL_JOB_STATES as unknown as never[],
      0,
      Math.max(limit * 6, 120) - 1,
      true,
    )

    const jobsByItemId = new Map<string, Job[]>()

    for (const job of jobs) {
      const itemId =
        job.data && typeof job.data.itemId === 'string' ? job.data.itemId : null

      if (!itemId) {
        continue
      }

      const group = jobsByItemId.get(itemId) ?? []
      group.push(job)
      jobsByItemId.set(itemId, group)
    }

    const underReviewItems = await this.prismaService.catalogItem.findMany({
      where: {
        publicationStatus: {
          in: ['UNDER_REVIEW', 'BLOCKED'],
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: Math.max(limit, 50),
      select: {
        id: true,
        title: true,
        description: true,
        exchangePreferences: true,
        ownerUserId: true,
        publicationStatus: true,
        updatedAt: true,
        createdAt: true,
        ownerModerationReport: true,
        category: {
          select: {
            name: true,
          },
        },
        images: {
          orderBy: [{ sortOrder: 'asc' }],
          take: 4,
          select: {
            storageUrl: true,
            sortOrder: true,
            isCover: true,
          },
        },
      },
    })

    const itemIds = Array.from(
      new Set([
        ...Array.from(jobsByItemId.keys()),
        ...underReviewItems.map((item) => item.id),
      ]),
    )

    if (!itemIds.length) {
      return []
    }

    const missingItemIds = itemIds.filter(
      (itemId) => !underReviewItems.some((item) => item.id === itemId),
    )

    const additionalItems = missingItemIds.length
      ? await this.prismaService.catalogItem.findMany({
          where: {
            id: {
              in: missingItemIds,
            },
          },
          select: {
            id: true,
            title: true,
            description: true,
            exchangePreferences: true,
            ownerUserId: true,
            publicationStatus: true,
            updatedAt: true,
            createdAt: true,
            ownerModerationReport: true,
            category: {
              select: {
                name: true,
              },
            },
            images: {
              orderBy: [{ sortOrder: 'asc' }],
              take: 4,
              select: {
                storageUrl: true,
                sortOrder: true,
                isCover: true,
              },
            },
          },
        })
      : []

    const itemMap = new Map(
      [...underReviewItems, ...additionalItems].map((item) => [item.id, item]),
    )

    const stateEntries = await Promise.all(
      itemIds.map(async (itemId) => [
        itemId,
        await this.readPublicationState(itemId),
      ] as const),
    )

    const stateMap = new Map(stateEntries)

    const operations: PublicationOperation[] = []

    for (const itemId of itemIds) {
      const item = itemMap.get(itemId)

      if (!item) {
        continue
      }

      const relatedJobs = jobsByItemId.get(itemId) ?? []
      if (!relatedJobs.length && item.publicationStatus === 'ACTIVE') {
        continue
      }
      const report = this.parseOwnerModerationReport(item.ownerModerationReport)
      const stateDetails = stateMap.get(itemId) ?? this.parsePublicationDetails(report)
      const jobStates = relatedJobs.map((job) => this.resolveJobStateFromTimestamps(job))
      const failedJobs = jobStates.filter((state) => state === 'failed').length
      const activeJobs = jobStates.filter((state) => state === 'active').length
      const waitingJobs = jobStates.filter((state) => state === 'waiting').length
      const imageJobs = relatedJobs.filter(
        (job) => job.name === CATALOG_IMAGE_MODERATION_JOB,
      )
      const textJobs = relatedJobs.filter(
        (job) => job.name === CATALOG_TEXT_MODERATION_JOB,
      )
      const latestJob =
        relatedJobs.slice().sort((left, right) => right.timestamp - left.timestamp)[0] ??
        null
      const failedJob =
        relatedJobs.find((job) => this.resolveJobStateFromTimestamps(job) === 'failed') ??
        null
      const latestJobState = latestJob
        ? this.resolveJobStateFromTimestamps(latestJob)
        : null
      const currentStage = this.resolvePublicationStage(
        item.publicationStatus,
        stateDetails,
      )
      const isStalled =
        item.publicationStatus === 'UNDER_REVIEW' &&
        activeJobs === 0 &&
        waitingJobs === 0 &&
        (stateDetails.pendingImages > 0 ||
          stateDetails.textStatus === 'QUEUED' ||
          stateDetails.textStatus === 'WAITING_IMAGES')
      const imageJobStates = imageJobs.map((job) =>
        this.resolveJobStateFromTimestamps(job),
      )
      const textJobStates = textJobs.map((job) =>
        this.resolveJobStateFromTimestamps(job),
      )
      const startedAt = this.resolveOperationStartedAt(item, relatedJobs)
      const lastActivityAt = this.resolveLastActivityAt(item, relatedJobs)
      const now = Date.now()
      const timeInFlowMs = Math.max(now - new Date(startedAt).getTime(), 0)
      const timeSinceLastActivityMs = lastActivityAt
        ? Math.max(now - new Date(lastActivityAt).getTime(), 0)
        : null
      const currentWorkerLabel = this.resolveCurrentWorkerLabel(
        currentStage,
        activeJobs,
        waitingJobs,
        stateDetails,
      )
      const imagePreviewUrls = item.images
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((image) => image.storageUrl)
      const coverImageUrl =
        item.images.find((image) => image.isCover)?.storageUrl ??
        imagePreviewUrls[0] ??
        null
      const failedWorkerLabel = failedJob
        ? this.resolveWorkerLabelByJobName(failedJob.name)
        : isStalled
          ? this.resolveCurrentWorkerLabel(currentStage, activeJobs, waitingJobs, stateDetails)
          : null
      const failedWorkerReason = failedJob?.failedReason ?? null

      if (
        item.publicationStatus === 'ACTIVE' &&
        activeJobs === 0 &&
        waitingJobs === 0 &&
        !isStalled
      ) {
        continue
      }

      operations.push({
        itemId: item.id,
        title: item.title,
        description: item.description,
        exchangePreferences: item.exchangePreferences ?? null,
        ownerUserId: item.ownerUserId,
        categoryName: item.category?.name ?? null,
        publicationStatus: item.publicationStatus,
        updatedAt: item.updatedAt.toISOString(),
        createdAt: item.createdAt.toISOString(),
        queueName: 'publication-moderation',
        currentStage,
        queueState:
          failedJobs > 0
            ? 'Fallido'
            : activeJobs > 0
              ? 'Procesando'
              : waitingJobs > 0
                ? 'En cola'
                : isStalled
                  ? 'Atascado'
                  : 'Esperando decisión',
        pendingImages: stateDetails.pendingImages,
        approvedImages: stateDetails.approvedImages,
        blockedImages: stateDetails.blockedImages,
        reviewImages: stateDetails.reviewImages,
        errorImages: stateDetails.errorImages,
        textStatus: stateDetails.textStatus,
        jobsQueued: relatedJobs.length,
        failedJobs,
        activeJobs,
        waitingJobs,
        isStalled,
        reasons: report?.reasons ?? [],
        coverImageUrl,
        imagePreviewUrls,
        textPreview: this.buildTextPreview(item.description, item.exchangePreferences),
        currentWorkerLabel,
        failedWorkerLabel,
        failedWorkerReason,
        imageJobSummary: {
          total: imageJobs.length,
          waiting: imageJobStates.filter((state) => state === 'waiting').length,
          active: imageJobStates.filter((state) => state === 'active').length,
          failed: imageJobStates.filter((state) => state === 'failed').length,
          completed: imageJobStates.filter((state) => state === 'completed').length,
        },
        textJobSummary: {
          state: textJobStates[0] ?? stateDetails.textStatus,
          failed: textJobStates.includes('failed'),
          completed: textJobStates.includes('completed'),
        },
        startedAt,
        lastActivityAt,
        timeInFlowMs,
        timeSinceLastActivityMs,
        latestJobId: latestJob ? String(latestJob.id) : null,
        failedJobId: failedJob ? String(failedJob.id) : null,
        latestJobLabel: latestJob ? this.resolveJobLabel(latestJob.name) : null,
        latestJobState,
        summary: this.buildOperationSummary(stateDetails),
      })
    }

    return operations
      .sort((left, right) => {
        if (Number(right.isStalled) !== Number(left.isStalled)) {
          return Number(right.isStalled) - Number(left.isStalled)
        }

        if (right.failedJobs !== left.failedJobs) {
          return right.failedJobs - left.failedJobs
        }

        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      })
      .slice(0, limit)
      .map((operation, index) => ({
        ...operation,
        reference: `PUB-${String(index + 1).padStart(3, '0')}`,
      }))
  }

  private parseOwnerModerationReport(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null
    }

    return value as {
      state?: string
      title?: string
      message?: string
      reasons?: string[]
      details?: Record<string, unknown>
    }
  }

  private parsePublicationDetails(report: ReturnType<typeof this.parseOwnerModerationReport>) {
    const details = report?.details ?? {}

    return {
      textStatus:
        typeof details.textStatus === 'string' ? details.textStatus : 'QUEUED',
      pendingImages:
        typeof details.pendingImages === 'number' ? details.pendingImages : 0,
      approvedImages:
        typeof details.approvedImages === 'number' ? details.approvedImages : 0,
      reviewImages:
        typeof details.reviewImages === 'number' ? details.reviewImages : 0,
      blockedImages:
        typeof details.blockedImages === 'number' ? details.blockedImages : 0,
      errorImages:
        typeof details.errorImages === 'number' ? details.errorImages : 0,
    }
  }

  private async readPublicationState(itemId: string): Promise<PublicationStateDetails | null> {
    const client = await this.queueService.getPublicationModerationQueue().client
    const raw = await client.hgetall(this.buildPublicationStateKey(itemId))

    if (!raw.version) {
      return null
    }

    return {
      textStatus: raw.textStatus ?? 'QUEUED',
      pendingImages: Number(raw.pendingImages ?? 0),
      approvedImages: Number(raw.approvedImages ?? 0),
      reviewImages: Number(raw.reviewImages ?? 0),
      blockedImages: Number(raw.blockedImages ?? 0),
      errorImages: Number(raw.errorImages ?? 0),
    }
  }

  private buildPublicationStateKey(itemId: string) {
    return `catalog-publication-review:${itemId}`
  }

  private resolvePublicationStage(
    publicationStatus: string,
    state: PublicationStateDetails,
  ) {
    if (publicationStatus === 'BLOCKED' || state.blockedImages > 0) {
      return 'Bloqueado'
    }

    if (state.pendingImages > 0 || state.textStatus === 'WAITING_IMAGES') {
      return 'Validando imágenes'
    }

    if (state.textStatus === 'QUEUED') {
      return 'Validando texto'
    }

    if (
      state.reviewImages > 0 ||
      state.errorImages > 0 ||
      state.textStatus === 'NEEDS_REVIEW' ||
      state.textStatus === 'ERROR'
    ) {
      return 'Revisión manual'
    }

    if (publicationStatus === 'ACTIVE') {
      return 'Activo'
    }

    return 'Pendiente de cierre'
  }

  private buildOperationSummary(state: PublicationStateDetails) {
    const parts = [
      `Texto: ${state.textStatus}`,
      `Imgs pendientes: ${Math.max(state.pendingImages, 0)}`,
    ]

    if (state.reviewImages > 0) {
      parts.push(`En revisión: ${state.reviewImages}`)
    }

    if (state.blockedImages > 0) {
      parts.push(`Bloqueadas: ${state.blockedImages}`)
    }

    if (state.errorImages > 0) {
      parts.push(`Errores: ${state.errorImages}`)
    }

    return parts.join(' · ')
  }

  private resolveStates(state?: string) {
    if (!state?.trim() || state === 'all') {
      return [...DEFAULT_JOB_STATES]
    }

    return state
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }

  private resolveQueueKey(queueKey?: string): CatalogQueueKey {
    if (!queueKey?.trim()) {
      return 'publicationModeration'
    }

    if (CATALOG_QUEUE_KEYS.includes(queueKey as CatalogQueueKey)) {
      return queueKey as CatalogQueueKey
    }

    throw new BadRequestException('Unsupported catalog queue key')
  }

  private resolveJobLabel(jobName: string) {
    switch (jobName) {
      case CATALOG_TEXT_MODERATION_JOB:
        return 'Moderación de texto'
      case CATALOG_IMAGE_MODERATION_JOB:
        return 'Moderación de imagen'
      case CATALOG_OUTBOX_DISPATCH_JOB:
        return 'Despacho de outbox'
      default:
        return jobName
    }
  }

  private resolveJobSummary(
    job: Job,
    item?: {
      id: string
      title: string
      publicationStatus: string
      ownerUserId: string
      category: { name: string } | null
    } | null,
  ) {
    if (item) {
      return `${item.title} · ${item.category?.name ?? 'Sin categoría'}`
    }

    if (job.name === CATALOG_OUTBOX_DISPATCH_JOB) {
      const eventId =
        job.data && typeof job.data.eventId === 'string' ? job.data.eventId : null
      return eventId ? `Evento ${eventId}` : 'Barrido de outbox'
    }

    return 'Sin entidad vinculada'
  }

  private resolveJobStateFromTimestamps(job: Job) {
    if (job.failedReason) {
      return 'failed'
    }

    if (job.finishedOn) {
      return 'completed'
    }

    if (job.processedOn) {
      return 'active'
    }

    return 'waiting'
  }

  private resolveWorkerLabelByJobName(jobName: string) {
    switch (jobName) {
      case CATALOG_IMAGE_MODERATION_JOB:
        return 'worker_Validador_Imagen'
      case CATALOG_TEXT_MODERATION_JOB:
        return 'worker_Validador_text'
      case CATALOG_OUTBOX_DISPATCH_JOB:
        return 'Catalog outbox'
      default:
        return 'Worker no identificado'
    }
  }

  private resolveCurrentWorkerLabel(
    currentStage: string,
    activeJobs: number,
    waitingJobs: number,
    state: PublicationStateDetails,
  ) {
    if (currentStage === 'Validando imágenes' || state.pendingImages > 0) {
      return activeJobs > 0 || waitingJobs > 0
        ? 'worker_Validador_Imagen'
        : 'worker_Validador_Imagen (sin respuesta)'
    }

    if (currentStage === 'Validando texto' || state.textStatus === 'QUEUED') {
      return activeJobs > 0 || waitingJobs > 0
        ? 'worker_Validador_text'
        : 'worker_Validador_text (sin respuesta)'
    }

    if (currentStage === 'Revisión manual') {
      return 'Revisión humana'
    }

    return 'Flujo completado'
  }

  private resolveOperationStartedAt(
    item: { createdAt: Date; updatedAt: Date },
    jobs: Job[],
  ) {
    const timestamps = jobs
      .map((job) => job.timestamp)
      .filter((value): value is number => typeof value === 'number' && value > 0)

    if (!timestamps.length) {
      return item.createdAt.toISOString()
    }

    return new Date(Math.min(...timestamps)).toISOString()
  }

  private resolveLastActivityAt(
    item: { updatedAt: Date },
    jobs: Job[],
  ) {
    const timestamps = jobs
      .flatMap((job) => [job.finishedOn, job.processedOn, job.timestamp])
      .filter((value): value is number => typeof value === 'number' && value > 0)

    if (!timestamps.length) {
      return item.updatedAt.toISOString()
    }

    return new Date(Math.max(...timestamps)).toISOString()
  }

  private buildTextPreview(description: string, exchangePreferences?: string | null) {
    const parts = [description.trim()]

    if (exchangePreferences?.trim()) {
      parts.push(`Busca: ${exchangePreferences.trim()}`)
    }

    return parts.join(' · ')
  }
}
