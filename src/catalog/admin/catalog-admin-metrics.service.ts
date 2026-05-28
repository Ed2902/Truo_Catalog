import { Injectable } from '@nestjs/common'
import {
  CatalogImageModerationStatus,
  CatalogItemPublicationStatus,
  CatalogItemReportStatus,
  CatalogModerationAppealStatus,
  Prisma,
  ExchangeDisputeStatus,
  ExchangeMatchStatus,
  ExchangeProposalStatus,
} from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ListAdminCatalogMetricsQueryDto } from '../dto/list-admin-catalog-metrics-query.dto'

@Injectable()
export class CatalogAdminMetricsService {
  constructor(private readonly prismaService: PrismaService) {}

  async getMetrics(query: ListAdminCatalogMetricsQueryDto) {
    const range = this.resolveMetricsRange(query)
    const dateFilter = this.buildDateFilter(range)

    const [
      matchesCreated,
      matchesCompleted,
      activeMatches,
      proposalsCreated,
      proposalsAccepted,
      itemsCreated,
      itemsPublished,
      activeItems,
      blockedItems,
      deletedItems,
      itemReports,
      pendingItemReports,
      moderationAppeals,
      pendingModerationAppeals,
      disputesCreated,
      openDisputes,
      resolvedDisputes,
      imageModerations,
      blockedImageModerations,
      underReviewItems,
    ] = await Promise.all([
      this.prismaService.exchangeMatch.count({ where: { createdAt: dateFilter } }),
      this.prismaService.exchangeMatch.count({
        where: {
          status: ExchangeMatchStatus.COMPLETED,
          completedAt: dateFilter,
        },
      }),
      this.prismaService.exchangeMatch.count({
        where: { status: ExchangeMatchStatus.ACTIVE },
      }),
      this.prismaService.exchangeProposal.count({
        where: { createdAt: dateFilter },
      }),
      this.prismaService.exchangeProposal.count({
        where: {
          status: ExchangeProposalStatus.ACCEPTED,
          updatedAt: dateFilter,
        },
      }),
      this.prismaService.catalogItem.count({ where: { createdAt: dateFilter } }),
      this.prismaService.catalogItem.count({
        where: { publishedAt: dateFilter },
      }),
      this.prismaService.catalogItem.count({
        where: {
          deletedAt: null,
          publicationStatus: {
            in: [
              CatalogItemPublicationStatus.ACTIVE,
              CatalogItemPublicationStatus.IN_NEGOTIATION,
            ],
          },
        },
      }),
      this.prismaService.catalogItem.count({
        where: {
          deletedAt: null,
          publicationStatus: CatalogItemPublicationStatus.BLOCKED,
        },
      }),
      this.prismaService.catalogItem.count({
        where: { deletedAt: dateFilter },
      }),
      this.prismaService.catalogItemReport.count({
        where: { createdAt: dateFilter },
      }),
      this.prismaService.catalogItemReport.count({
        where: { status: CatalogItemReportStatus.PENDING },
      }),
      this.prismaService.catalogModerationAppeal.count({
        where: { createdAt: dateFilter },
      }),
      this.prismaService.catalogModerationAppeal.count({
        where: { status: CatalogModerationAppealStatus.PENDING },
      }),
      this.safeExchangeDisputeCount({
        where: { createdAt: dateFilter },
      }),
      this.safeExchangeDisputeCount({
        where: {
          status: {
            in: [ExchangeDisputeStatus.OPEN, ExchangeDisputeStatus.IN_REVIEW],
          },
        },
      }),
      this.safeExchangeDisputeCount({
        where: {
          status: ExchangeDisputeStatus.RESOLVED,
          resolvedAt: dateFilter,
        },
      }),
      this.prismaService.catalogItemImageModeration.count({
        where: { createdAt: dateFilter },
      }),
      this.prismaService.catalogItemImageModeration.count({
        where: {
          status: CatalogImageModerationStatus.BLOCKED,
          createdAt: dateFilter,
        },
      }),
      this.prismaService.catalogItem.count({
        where: {
          deletedAt: null,
          publicationStatus: CatalogItemPublicationStatus.UNDER_REVIEW,
        },
      }),
    ])

    return {
      service: 'catalog',
      range,
      totals: {
        activeMatches,
        activeItems,
        blockedItems,
        underReviewItems,
        pendingItemReports,
        pendingModerationAppeals,
        openDisputes,
      },
      period: {
        matchesCreated,
        matchesCompleted,
        proposalsCreated,
        proposalsAccepted,
        itemsCreated,
        itemsPublished,
        deletedItems,
        itemReports,
        disputesCreated,
        resolvedDisputes,
        moderationAppeals,
        imageModerations,
        blockedImageModerations,
      },
    }
  }

  private resolveMetricsRange(query: ListAdminCatalogMetricsQueryDto) {
    const to = query.to ? new Date(query.to) : new Date()
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000)

    return { from, to }
  }

  private buildDateFilter(range: { from: Date; to: Date }) {
    return {
      gte: range.from,
      lte: range.to,
    }
  }

  private async safeExchangeDisputeCount(
    args: Prisma.ExchangeDisputeCountArgs,
  ) {
    try {
      return await this.prismaService.exchangeDispute.count(args)
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2021'
      ) {
        return 0
      }

      throw error
    }
  }
}
