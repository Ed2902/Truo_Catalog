import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  CatalogImageModerationRecommendedAction,
  CatalogImageModerationRiskLevel,
  CatalogImageModerationStatus,
  CatalogItemReportReason,
  CatalogItemReportStatus,
  CatalogModerationAppealStatus,
  CatalogItemPublicationStatus,
  Prisma,
} from '@prisma/client'
import { randomUUID } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { sanitizePlainText } from '../../common/utils/sanitize-text.util'
import { CreateCatalogItemReportDto } from '../dto/create-catalog-item-report.dto'
import { CreateModerationAppealDto } from '../dto/create-moderation-appeal.dto'
import { ListAdminProductModerationQueryDto } from '../dto/list-admin-product-moderation-query.dto'
import { ListCatalogItemReportsQueryDto } from '../dto/list-catalog-item-reports-query.dto'
import { ListModerationAppealsQueryDto } from '../dto/list-moderation-appeals-query.dto'
import { ListModerationReviewsQueryDto } from '../dto/list-moderation-reviews-query.dto'
import {
  ResolveCatalogItemReportAction,
  ResolveCatalogItemReportDto,
} from '../dto/resolve-catalog-item-report.dto'
import {
  ResolveModerationAppealAction,
  ResolveModerationAppealDto,
} from '../dto/resolve-moderation-appeal.dto'
import {
  ResolveModerationReviewAction,
  ResolveModerationReviewDto,
} from '../dto/resolve-moderation-review.dto'
import { CatalogActor } from '../interfaces/catalog-actor.interface'

type ImageAnalyzerResponse = {
  jobId: string
  productId: string
  detectedProductType: string
  isProhibited: boolean
  riskLevel: keyof typeof CatalogImageModerationRiskLevel
  confidence: number
  flags: string[]
  recommendedAction: keyof typeof CatalogImageModerationRecommendedAction
}

const moderationDetailInclude = {
  catalogItem: {
    include: {
      category: true,
      images: {
        orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
    },
  },
  catalogItemImage: true,
  appeals: {
    orderBy: [{ createdAt: 'desc' }],
  },
} satisfies Prisma.CatalogItemImageModerationInclude

const appealDetailInclude = {
  catalogItem: {
    include: {
      category: true,
      images: {
        orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
    },
  },
  moderation: true,
} satisfies Prisma.CatalogModerationAppealInclude

const reportDetailInclude = {
  catalogItem: {
    include: {
      category: true,
      images: {
        orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
    },
  },
} satisfies Prisma.CatalogItemReportInclude

const adminProductQueueImageStatuses = [
  CatalogImageModerationStatus.PENDING,
  CatalogImageModerationStatus.NEEDS_REVIEW,
  CatalogImageModerationStatus.ERROR,
  CatalogImageModerationStatus.BLOCKED,
]

const adminProductQueueInclude = {
  category: true,
  images: {
    orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  },
  imageModerations: {
    where: {
      status: {
        in: adminProductQueueImageStatuses,
      },
    },
    include: {
      catalogItemImage: true,
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 6,
  },
  reports: {
    where: {
      status: CatalogItemReportStatus.PENDING,
    },
    orderBy: [{ createdAt: 'asc' }],
    take: 5,
  },
  moderationAppeals: {
    where: {
      status: CatalogModerationAppealStatus.PENDING,
    },
    include: {
      moderation: true,
    },
    orderBy: [{ createdAt: 'asc' }],
    take: 5,
  },
} satisfies Prisma.CatalogItemInclude

@Injectable()
export class CatalogImageModerationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async analyzeCatalogItemImage(input: {
    catalogItemId: string
    catalogItemImageId?: string
    imageUrl: string
  }) {
    const jobId = `image-analysis_${randomUUID()}`
    const moderation = await this.prismaService.catalogItemImageModeration.create({
      data: {
        catalogItemId: input.catalogItemId,
        catalogItemImageId: input.catalogItemImageId ?? null,
        jobId,
      },
    })

    try {
      const result = await this.callImageAnalyzerWorker({
        jobId,
        productId: input.catalogItemId,
        imageUrl: input.imageUrl,
      })

      return this.persistAnalyzerResult(moderation.id, result)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'image_analysis_failed'

      const storedModeration =
        await this.prismaService.catalogItemImageModeration.update({
          where: {
            id: moderation.id,
          },
          data: {
            status: CatalogImageModerationStatus.ERROR,
            errorMessage,
            analyzedAt: new Date(),
          },
          include: moderationDetailInclude,
        })

      await this.applyItemStatusForModeration(
        input.catalogItemId,
        CatalogImageModerationStatus.ERROR,
      )

      return this.serializeModeration(storedModeration)
    }
  }

  async listReviews(query: ListModerationReviewsQueryDto) {
    const statusFilter = query.status
      ? [query.status as unknown as CatalogImageModerationStatus]
      : [
          CatalogImageModerationStatus.NEEDS_REVIEW,
          CatalogImageModerationStatus.ERROR,
        ]

    const moderations =
      await this.prismaService.catalogItemImageModeration.findMany({
        where: {
          status: {
            in: statusFilter,
          },
          ...(query.ownerUserId
            ? {
                catalogItem: {
                  ownerUserId: query.ownerUserId,
                },
              }
            : {}),
        },
        include: moderationDetailInclude,
        orderBy: [{ createdAt: 'asc' }],
        take: query.take ?? 50,
      })

    return moderations.map(moderation => this.serializeModeration(moderation))
  }

  async listBlocked(query: ListModerationReviewsQueryDto) {
    return this.listReviews({
      ...query,
      status: CatalogImageModerationStatus.BLOCKED as never,
    })
  }

  async listAdminProductModerationQueue(
    query: ListAdminProductModerationQueryDto,
  ) {
    const requestedStatus = query.status ?? 'all'
    const pendingClauses: Prisma.CatalogItemWhereInput[] = [
      {
        publicationStatus: CatalogItemPublicationStatus.UNDER_REVIEW,
      },
      {
        imageModerations: {
          some: {
            status: {
              in: [
                CatalogImageModerationStatus.PENDING,
                CatalogImageModerationStatus.NEEDS_REVIEW,
                CatalogImageModerationStatus.ERROR,
              ],
            },
          },
        },
      },
      {
        reports: {
          some: {
            status: CatalogItemReportStatus.PENDING,
          },
        },
      },
      {
        moderationAppeals: {
          some: {
            status: CatalogModerationAppealStatus.PENDING,
          },
        },
      },
    ]
    const blockedClauses: Prisma.CatalogItemWhereInput[] = [
      {
        publicationStatus: CatalogItemPublicationStatus.BLOCKED,
      },
      {
        imageModerations: {
          some: {
            status: CatalogImageModerationStatus.BLOCKED,
          },
        },
      },
    ]
    const statusClauses =
      requestedStatus === 'pending'
        ? pendingClauses
        : requestedStatus === 'blocked'
          ? blockedClauses
          : [...pendingClauses, ...blockedClauses]

    const items = await this.prismaService.catalogItem.findMany({
      where: {
        deletedAt: null,
        OR: statusClauses,
      },
      include: adminProductQueueInclude,
      orderBy: [{ updatedAt: 'desc' }],
      take: query.take ?? 75,
    })

    return items.map(item => this.serializeAdminProductQueueItem(item))
  }

  async resolveReview(
    moderationId: string,
    resolveReviewDto: ResolveModerationReviewDto,
  ) {
    const moderation =
      await this.prismaService.catalogItemImageModeration.findUnique({
        where: {
          id: moderationId,
        },
        include: moderationDetailInclude,
      })

    if (!moderation) {
      throw new NotFoundException('Moderation review not found')
    }

    const reviewNotes = resolveReviewDto.notes
      ? sanitizePlainText(resolveReviewDto.notes, { preserveNewLines: true })
      : null
    const reviewedByUserId = resolveReviewDto.reviewerUserId?.trim() || null
    const nextStatus =
      resolveReviewDto.action === ResolveModerationReviewAction.APPROVE
        ? CatalogImageModerationStatus.APPROVED
        : CatalogImageModerationStatus.BLOCKED

    const updatedModeration =
      await this.prismaService.catalogItemImageModeration.update({
        where: {
          id: moderationId,
        },
        data: {
          status: nextStatus,
          reviewedAt: new Date(),
          reviewedByUserId,
          reviewNotes,
        },
        include: moderationDetailInclude,
      })

    if (nextStatus === CatalogImageModerationStatus.APPROVED) {
      await this.promoteItemIfNoOpenModeration(moderation.catalogItemId)
    } else {
      await this.applyItemStatusForModeration(
        moderation.catalogItemId,
        CatalogImageModerationStatus.BLOCKED,
      )
    }

    return this.serializeModeration(updatedModeration)
  }

  async createAppeal(
    actor: CatalogActor,
    itemId: string,
    createAppealDto: CreateModerationAppealDto,
  ) {
    const item = await this.prismaService.catalogItem.findUnique({
      where: {
        id: itemId,
      },
      include: {
        imageModerations: {
          orderBy: [{ createdAt: 'desc' }],
          take: 1,
        },
      },
    })

    if (!item || item.deletedAt) {
      throw new NotFoundException('Catalog item not found')
    }

    if (item.ownerUserId !== actor.userId) {
      throw new NotFoundException('Catalog item not found')
    }

    const latestModeration = item.imageModerations[0]
    const appealableModerationStatuses: CatalogImageModerationStatus[] = [
      CatalogImageModerationStatus.BLOCKED,
      CatalogImageModerationStatus.NEEDS_REVIEW,
      CatalogImageModerationStatus.ERROR,
    ]
    const canAppeal =
      item.publicationStatus === CatalogItemPublicationStatus.BLOCKED ||
      item.publicationStatus === CatalogItemPublicationStatus.UNDER_REVIEW ||
      Boolean(
        latestModeration &&
          appealableModerationStatuses.includes(latestModeration.status),
      )

    if (!canAppeal) {
      throw new BadRequestException('This item is not eligible for appeal')
    }

    const existingAppeal = await this.prismaService.catalogModerationAppeal.findFirst({
      where: {
        catalogItemId: itemId,
        status: CatalogModerationAppealStatus.PENDING,
      },
      select: {
        id: true,
      },
    })

    if (existingAppeal) {
      throw new BadRequestException('This item already has a pending appeal')
    }

    const appeal = await this.prismaService.catalogModerationAppeal.create({
      data: {
        catalogItemId: itemId,
        moderationId: latestModeration?.id ?? null,
        ownerUserId: actor.userId,
        message: sanitizePlainText(createAppealDto.message, {
          preserveNewLines: true,
        }),
      },
      include: appealDetailInclude,
    })

    return this.serializeAppeal(appeal)
  }

  async listMyAppeals(actor: CatalogActor, itemId: string) {
    const item = await this.prismaService.catalogItem.findUnique({
      where: {
        id: itemId,
      },
      select: {
        id: true,
        ownerUserId: true,
        deletedAt: true,
      },
    })

    if (!item || item.deletedAt || item.ownerUserId !== actor.userId) {
      throw new NotFoundException('Catalog item not found')
    }

    const appeals = await this.prismaService.catalogModerationAppeal.findMany({
      where: {
        catalogItemId: itemId,
        ownerUserId: actor.userId,
      },
      include: appealDetailInclude,
      orderBy: [{ createdAt: 'desc' }],
    })

    return appeals.map(appeal => this.serializeAppeal(appeal))
  }

  async listAppeals(query: ListModerationAppealsQueryDto) {
    const appeals = await this.prismaService.catalogModerationAppeal.findMany({
      where: {
        ...(query.status
          ? { status: query.status as unknown as CatalogModerationAppealStatus }
          : {}),
        ...(query.ownerUserId ? { ownerUserId: query.ownerUserId } : {}),
      },
      include: appealDetailInclude,
      orderBy: [{ createdAt: 'asc' }],
      take: query.take ?? 50,
    })

    return appeals.map(appeal => this.serializeAppeal(appeal))
  }

  async createReport(
    actor: CatalogActor,
    itemId: string,
    createReportDto: CreateCatalogItemReportDto,
  ) {
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
      throw new NotFoundException('Catalog item not found')
    }

    if (item.ownerUserId === actor.userId) {
      throw new BadRequestException('You cannot report your own item')
    }

    const reportablePublicationStatuses: CatalogItemPublicationStatus[] = [
        CatalogItemPublicationStatus.ACTIVE,
        CatalogItemPublicationStatus.IN_NEGOTIATION,
      ]

    if (!reportablePublicationStatuses.includes(item.publicationStatus)) {
      throw new BadRequestException('Only public active items can be reported')
    }

    const existingPendingReport =
      await this.prismaService.catalogItemReport.findFirst({
        where: {
          catalogItemId: itemId,
          reporterUserId: actor.userId,
          status: CatalogItemReportStatus.PENDING,
        },
        select: {
          id: true,
        },
      })

    if (existingPendingReport) {
      throw new BadRequestException('You already have a pending report for this item')
    }

    const report = await this.prismaService.catalogItemReport.create({
      data: {
        catalogItemId: itemId,
        reporterUserId: actor.userId,
        reason: createReportDto.reason as CatalogItemReportReason,
        details: createReportDto.details
          ? sanitizePlainText(createReportDto.details, { preserveNewLines: true })
          : null,
      },
      include: reportDetailInclude,
    })

    return this.serializeReport(report)
  }

  async listReports(query: ListCatalogItemReportsQueryDto) {
    const reports = await this.prismaService.catalogItemReport.findMany({
      where: {
        ...(query.status
          ? { status: query.status as unknown as CatalogItemReportStatus }
          : { status: CatalogItemReportStatus.PENDING }),
        ...(query.reporterUserId
          ? { reporterUserId: query.reporterUserId }
          : {}),
        ...(query.ownerUserId
          ? {
              catalogItem: {
                ownerUserId: query.ownerUserId,
              },
            }
          : {}),
      },
      include: reportDetailInclude,
      orderBy: [{ createdAt: 'asc' }],
      take: query.take ?? 50,
    })

    return reports.map(report => this.serializeReport(report))
  }

  async resolveReport(
    reportId: string,
    resolveReportDto: ResolveCatalogItemReportDto,
  ) {
    const report = await this.prismaService.catalogItemReport.findUnique({
      where: {
        id: reportId,
      },
      include: reportDetailInclude,
    })

    if (!report) {
      throw new NotFoundException('Catalog item report not found')
    }

    if (report.status !== CatalogItemReportStatus.PENDING) {
      throw new BadRequestException('Report is already resolved')
    }

    const notes = resolveReportDto.notes
      ? sanitizePlainText(resolveReportDto.notes, { preserveNewLines: true })
      : null
    const reviewedByUserId = resolveReportDto.reviewerUserId?.trim() || null

    const nextStatus =
      resolveReportDto.action === ResolveCatalogItemReportAction.DISMISS
        ? CatalogItemReportStatus.DISMISSED
        : resolveReportDto.action ===
            ResolveCatalogItemReportAction.SEND_TO_REVIEW
          ? CatalogItemReportStatus.SENT_TO_REVIEW
          : CatalogItemReportStatus.ACTIONED

    const updatedReport = await this.prismaService.$transaction(async tx => {
      if (
        resolveReportDto.action === ResolveCatalogItemReportAction.SEND_TO_REVIEW
      ) {
        await tx.catalogItem.update({
          where: {
            id: report.catalogItemId,
          },
          data: {
            publicationStatus: CatalogItemPublicationStatus.UNDER_REVIEW,
          },
        })
      }

      if (
        resolveReportDto.action === ResolveCatalogItemReportAction.REMOVE_PRODUCT
      ) {
        await tx.catalogItem.update({
          where: {
            id: report.catalogItemId,
          },
          data: {
            publicationStatus: CatalogItemPublicationStatus.BLOCKED,
          },
        })
      }

      return tx.catalogItemReport.update({
        where: {
          id: reportId,
        },
        data: {
          status: nextStatus,
          resolutionNotes: notes,
          reviewedByUserId,
          reviewedAt: new Date(),
        },
        include: reportDetailInclude,
      })
    })

    return this.serializeReport(updatedReport)
  }

  async resolveAppeal(
    appealId: string,
    resolveAppealDto: ResolveModerationAppealDto,
  ) {
    const appeal = await this.prismaService.catalogModerationAppeal.findUnique({
      where: {
        id: appealId,
      },
      include: appealDetailInclude,
    })

    if (!appeal) {
      throw new NotFoundException('Moderation appeal not found')
    }

    if (appeal.status !== CatalogModerationAppealStatus.PENDING) {
      throw new BadRequestException('Appeal is already resolved')
    }

    const approved =
      resolveAppealDto.action === ResolveModerationAppealAction.APPROVE
    const nextAppealStatus = approved
      ? CatalogModerationAppealStatus.APPROVED
      : CatalogModerationAppealStatus.REJECTED

    const updatedAppeal = await this.prismaService.$transaction(async tx => {
      if (appeal.moderationId) {
        await tx.catalogItemImageModeration.update({
          where: {
            id: appeal.moderationId,
          },
          data: {
            status: approved
              ? CatalogImageModerationStatus.APPROVED
              : CatalogImageModerationStatus.BLOCKED,
            reviewedAt: new Date(),
            reviewedByUserId: resolveAppealDto.reviewerUserId?.trim() || null,
            reviewNotes:
              resolveAppealDto.resolutionMessage?.trim() || null,
          },
        })
      }

      await tx.catalogItem.update({
        where: {
          id: appeal.catalogItemId,
        },
        data: {
          publicationStatus: approved
            ? CatalogItemPublicationStatus.ACTIVE
            : CatalogItemPublicationStatus.BLOCKED,
        },
      })

      return tx.catalogModerationAppeal.update({
        where: {
          id: appealId,
        },
        data: {
          status: nextAppealStatus,
          resolutionMessage:
            resolveAppealDto.resolutionMessage?.trim() || null,
          resolvedByUserId: resolveAppealDto.reviewerUserId?.trim() || null,
          resolvedAt: new Date(),
        },
        include: appealDetailInclude,
      })
    })

    return this.serializeAppeal(updatedAppeal)
  }

  private async callImageAnalyzerWorker(input: {
    jobId: string
    productId: string
    imageUrl: string
  }): Promise<ImageAnalyzerResponse> {
    const workerUrl = this.configService.get<string>(
      'moderation.imageAnalyzerUrl',
    )

    if (!workerUrl) {
      throw new ServiceUnavailableException('Image analyzer worker is not configured')
    }

    const timeoutMs =
      this.configService.get<number>('moderation.imageAnalyzerTimeoutMs') ??
      15000
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(
        `${workerUrl.replace(/\/+$/, '')}/analyze/product-image`,
        {
          method: 'POST',
          headers: this.buildWorkerHeaders(),
          body: JSON.stringify(input),
          signal: controller.signal,
        },
      )

      if (!response.ok) {
        throw new ServiceUnavailableException(
          `Image analyzer failed with status ${response.status}`,
        )
      }

      return (await response.json()) as ImageAnalyzerResponse
    } finally {
      clearTimeout(timeout)
    }
  }

  private async persistAnalyzerResult(
    moderationId: string,
    result: ImageAnalyzerResponse,
  ) {
    const status = this.resolveModerationStatus(result.recommendedAction)
    const moderation =
      await this.prismaService.catalogItemImageModeration.update({
        where: {
          id: moderationId,
        },
        data: {
          status,
          detectedProductType: result.detectedProductType,
          isProhibited: result.isProhibited,
          riskLevel: result.riskLevel as CatalogImageModerationRiskLevel,
          confidence: result.confidence,
          flags: result.flags,
          recommendedAction:
            result.recommendedAction as CatalogImageModerationRecommendedAction,
          rawResult: result as unknown as Prisma.InputJsonValue,
          analyzedAt: new Date(),
        },
        include: moderationDetailInclude,
      })

    await this.applyItemStatusForModeration(
      moderation.catalogItemId,
      status,
    )

    return this.serializeModeration(moderation)
  }

  private buildWorkerHeaders() {
    const internalToken = this.configService.get<string>(
      'moderation.internalToken',
    )

    if (!internalToken) {
      throw new ServiceUnavailableException(
        'Moderation internal token is not configured',
      )
    }

    return {
      'Content-Type': 'application/json',
      'X-Internal-Token': internalToken,
    }
  }

  private resolveModerationStatus(
    recommendedAction: keyof typeof CatalogImageModerationRecommendedAction,
  ) {
    if (
      recommendedAction === CatalogImageModerationRecommendedAction.APPROVE ||
      recommendedAction === CatalogImageModerationRecommendedAction.KEEP_VISIBLE
    ) {
      return CatalogImageModerationStatus.APPROVED
    }

    if (
      recommendedAction ===
      CatalogImageModerationRecommendedAction.REMOVE_PRODUCT
    ) {
      return CatalogImageModerationStatus.BLOCKED
    }

    return CatalogImageModerationStatus.NEEDS_REVIEW
  }

  private async applyItemStatusForModeration(
    itemId: string,
    moderationStatus: CatalogImageModerationStatus,
  ) {
    if (moderationStatus === CatalogImageModerationStatus.BLOCKED) {
      await this.prismaService.catalogItem.update({
        where: {
          id: itemId,
        },
        data: {
          publicationStatus: CatalogItemPublicationStatus.BLOCKED,
        },
      })
      return
    }

    if (
      moderationStatus === CatalogImageModerationStatus.NEEDS_REVIEW ||
      moderationStatus === CatalogImageModerationStatus.ERROR
    ) {
      await this.prismaService.catalogItem.update({
        where: {
          id: itemId,
        },
        data: {
          publicationStatus: CatalogItemPublicationStatus.UNDER_REVIEW,
        },
      })
    }
  }

  async promoteItemIfNoOpenModeration(itemId: string) {
    const openModerationCount =
      await this.prismaService.catalogItemImageModeration.count({
        where: {
          catalogItemId: itemId,
          status: {
            in: [
              CatalogImageModerationStatus.BLOCKED,
              CatalogImageModerationStatus.NEEDS_REVIEW,
              CatalogImageModerationStatus.ERROR,
            ],
          },
        },
      })

    if (openModerationCount > 0) {
      return
    }

    const item = await this.prismaService.catalogItem.findUnique({
      where: {
        id: itemId,
      },
      select: {
        publishedAt: true,
      },
    })

    await this.prismaService.catalogItem.update({
      where: {
        id: itemId,
      },
      data: {
        publicationStatus: CatalogItemPublicationStatus.ACTIVE,
        publishedAt: item?.publishedAt ?? new Date(),
      },
    })
  }

  private serializeModeration(
    moderation: Prisma.CatalogItemImageModerationGetPayload<{
      include: typeof moderationDetailInclude
    }>,
  ) {
    return {
      id: moderation.id,
      catalogItemId: moderation.catalogItemId,
      catalogItemImageId: moderation.catalogItemImageId,
      jobId: moderation.jobId,
      status: moderation.status,
      detectedProductType: moderation.detectedProductType,
      isProhibited: moderation.isProhibited,
      riskLevel: moderation.riskLevel,
      confidence: moderation.confidence,
      flags: moderation.flags,
      recommendedAction: moderation.recommendedAction,
      errorMessage: moderation.errorMessage,
      analyzedAt: moderation.analyzedAt,
      reviewedAt: moderation.reviewedAt,
      reviewedByUserId: moderation.reviewedByUserId,
      reviewNotes: moderation.reviewNotes,
      createdAt: moderation.createdAt,
      updatedAt: moderation.updatedAt,
      item: this.serializeModerationItem(moderation.catalogItem),
      image: moderation.catalogItemImage
        ? {
            id: moderation.catalogItemImage.id,
            storageUrl: moderation.catalogItemImage.storageUrl,
            storagePath: moderation.catalogItemImage.storagePath,
            sortOrder: moderation.catalogItemImage.sortOrder,
            isCover: moderation.catalogItemImage.isCover,
          }
        : null,
      appeals: moderation.appeals.map(appeal => ({
        id: appeal.id,
        status: appeal.status,
        message: appeal.message,
        createdAt: appeal.createdAt,
      })),
    }
  }

  private serializeAppeal(
    appeal: Prisma.CatalogModerationAppealGetPayload<{
      include: typeof appealDetailInclude
    }>,
  ) {
    return {
      id: appeal.id,
      catalogItemId: appeal.catalogItemId,
      moderationId: appeal.moderationId,
      ownerUserId: appeal.ownerUserId,
      status: appeal.status,
      message: appeal.message,
      resolutionMessage: appeal.resolutionMessage,
      resolvedByUserId: appeal.resolvedByUserId,
      resolvedAt: appeal.resolvedAt,
      createdAt: appeal.createdAt,
      updatedAt: appeal.updatedAt,
      item: this.serializeModerationItem(appeal.catalogItem),
      moderation: appeal.moderation
        ? {
            id: appeal.moderation.id,
            status: appeal.moderation.status,
            flags: appeal.moderation.flags,
            recommendedAction: appeal.moderation.recommendedAction,
          }
        : null,
    }
  }

  private serializeReport(
    report: Prisma.CatalogItemReportGetPayload<{
      include: typeof reportDetailInclude
    }>,
  ) {
    return {
      id: report.id,
      catalogItemId: report.catalogItemId,
      reporterUserId: report.reporterUserId,
      reason: report.reason,
      details: report.details,
      status: report.status,
      resolutionNotes: report.resolutionNotes,
      reviewedByUserId: report.reviewedByUserId,
      reviewedAt: report.reviewedAt,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      item: this.serializeModerationItem(report.catalogItem),
    }
  }

  private serializeAdminProductQueueItem(
    item: Prisma.CatalogItemGetPayload<{
      include: typeof adminProductQueueInclude
    }>,
  ) {
    const coverImage =
      item.images.find(image => image.isCover) ?? item.images[0] ?? null
    const pendingImageStatuses: CatalogImageModerationStatus[] = [
      CatalogImageModerationStatus.PENDING,
      CatalogImageModerationStatus.NEEDS_REVIEW,
      CatalogImageModerationStatus.ERROR,
    ]
    const pendingModerations = item.imageModerations.filter(moderation =>
      pendingImageStatuses.includes(moderation.status),
    )
    const blockedModerations = item.imageModerations.filter(
      moderation => moderation.status === CatalogImageModerationStatus.BLOCKED,
    )
    const reviewReasons = [
      item.publicationStatus === CatalogItemPublicationStatus.UNDER_REVIEW
        ? 'Producto en revision'
        : null,
      item.publicationStatus === CatalogItemPublicationStatus.BLOCKED
        ? 'Producto bloqueado'
        : null,
      pendingModerations.length > 0
        ? `${pendingModerations.length} moderacion(es) pendientes`
        : null,
      blockedModerations.length > 0
        ? `${blockedModerations.length} moderacion(es) bloqueadas`
        : null,
      item.reports.length > 0
        ? `${item.reports.length} reporte(s) abiertos`
        : null,
      item.moderationAppeals.length > 0
        ? `${item.moderationAppeals.length} apelacion(es) pendientes`
        : null,
    ].filter(Boolean)

    return {
      id: item.id,
      ownerUserId: item.ownerUserId,
      title: item.title,
      slug: item.slug,
      description: item.description,
      publicationStatus: item.publicationStatus,
      condition: item.condition,
      subjectiveValue: item.subjectiveValue,
      exchangePreferences: item.exchangePreferences,
      ownerModerationReport: item.ownerModerationReport,
      publishedAt: item.publishedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      category: {
        id: item.category.id,
        name: item.category.name,
        slug: item.category.slug,
      },
      coverImage: coverImage
        ? {
            id: coverImage.id,
            storageUrl: coverImage.storageUrl,
            storagePath: coverImage.storagePath,
            sortOrder: coverImage.sortOrder,
            isCover: coverImage.isCover,
          }
        : null,
      images: item.images.map(image => ({
        id: image.id,
        storageUrl: image.storageUrl,
        storagePath: image.storagePath,
        sortOrder: image.sortOrder,
        isCover: image.isCover,
      })),
      reviewReasons,
      moderationSummary: {
        pending: pendingModerations.length,
        blocked: blockedModerations.length,
        reports: item.reports.length,
        appeals: item.moderationAppeals.length,
      },
      latestModerations: item.imageModerations.map(moderation => ({
        id: moderation.id,
        catalogItemImageId: moderation.catalogItemImageId,
        status: moderation.status,
        detectedProductType: moderation.detectedProductType,
        isProhibited: moderation.isProhibited,
        riskLevel: moderation.riskLevel,
        confidence: moderation.confidence,
        flags: moderation.flags,
        recommendedAction: moderation.recommendedAction,
        errorMessage: moderation.errorMessage,
        analyzedAt: moderation.analyzedAt,
        reviewedAt: moderation.reviewedAt,
        createdAt: moderation.createdAt,
        image: moderation.catalogItemImage
          ? {
              id: moderation.catalogItemImage.id,
              storageUrl: moderation.catalogItemImage.storageUrl,
              storagePath: moderation.catalogItemImage.storagePath,
              sortOrder: moderation.catalogItemImage.sortOrder,
              isCover: moderation.catalogItemImage.isCover,
            }
          : null,
      })),
      pendingReports: item.reports.map(report => ({
        id: report.id,
        reporterUserId: report.reporterUserId,
        reason: report.reason,
        details: report.details,
        status: report.status,
        createdAt: report.createdAt,
      })),
      pendingAppeals: item.moderationAppeals.map(appeal => ({
        id: appeal.id,
        moderationId: appeal.moderationId,
        ownerUserId: appeal.ownerUserId,
        status: appeal.status,
        message: appeal.message,
        createdAt: appeal.createdAt,
        moderation: appeal.moderation
          ? {
              id: appeal.moderation.id,
              status: appeal.moderation.status,
              flags: appeal.moderation.flags,
              recommendedAction: appeal.moderation.recommendedAction,
            }
          : null,
      })),
    }
  }

  private serializeModerationItem(
    item: Prisma.CatalogItemGetPayload<{
      include: {
        category: true
        images: true
      }
    }>,
  ) {
    return {
      id: item.id,
      ownerUserId: item.ownerUserId,
      title: item.title,
      description: item.description,
      publicationStatus: item.publicationStatus,
      category: {
        id: item.category.id,
        name: item.category.name,
        slug: item.category.slug,
      },
      images: item.images.map(image => ({
        id: image.id,
        storageUrl: image.storageUrl,
        storagePath: image.storagePath,
        sortOrder: image.sortOrder,
        isCover: image.isCover,
      })),
    }
  }
}
