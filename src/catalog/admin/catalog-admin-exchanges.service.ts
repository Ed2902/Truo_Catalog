import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import {
  ExchangeMatchStatus,
  ExchangeProposalStatus,
} from '../shared/catalog.constants'
import { CatalogItemsService } from '../items/catalog-items.service'
import { ListAdminExchangesQueryDto } from '../dto/list-admin-exchanges-query.dto'
import { UpdateAdminExchangeMatchStatusDto } from '../dto/update-admin-exchange-match-status.dto'

const adminExchangeInclude = {
  proposal: true,
  requestedItem: {
    include: { category: true },
  },
  offeredItem: {
    include: { category: true },
  },
} satisfies Prisma.ExchangeMatchInclude

@Injectable()
export class CatalogAdminExchangesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly itemsService: CatalogItemsService,
  ) {}

  async listExchanges(query: ListAdminExchangesQueryDto) {
    const take = query.take ?? 50
    const search = query.q?.trim()

    const matches = await this.prismaService.exchangeMatch.findMany({
      where: {
        ...(query.matchStatus ? { status: query.matchStatus as never } : {}),
        ...(query.userId
          ? {
              OR: [
                { requesterUserId: query.userId },
                { targetUserId: query.userId },
              ],
            }
          : {}),
        ...(search
          ? {
              OR: [
                { requesterUserId: { contains: search, mode: 'insensitive' } },
                { targetUserId: { contains: search, mode: 'insensitive' } },
                {
                  requestedItem: {
                    title: { contains: search, mode: 'insensitive' },
                  },
                },
                {
                  offeredItem: {
                    title: { contains: search, mode: 'insensitive' },
                  },
                },
              ],
            }
          : {}),
      },
      include: adminExchangeInclude,
      orderBy: [{ updatedAt: 'desc' }],
      take,
    })

    const proposals = await this.prismaService.exchangeProposal.findMany({
      where: {
        ...(query.proposalStatus
          ? { status: query.proposalStatus as never }
          : {}),
        ...(query.userId
          ? {
              OR: [
                { requesterUserId: query.userId },
                { targetUserId: query.userId },
              ],
            }
          : {}),
        ...(search
          ? {
              OR: [
                { requesterUserId: { contains: search, mode: 'insensitive' } },
                { targetUserId: { contains: search, mode: 'insensitive' } },
                { message: { contains: search, mode: 'insensitive' } },
                {
                  requestedItem: {
                    title: { contains: search, mode: 'insensitive' },
                  },
                },
                {
                  offeredItem: {
                    title: { contains: search, mode: 'insensitive' },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        match: true,
        requestedItem: { include: { category: true } },
        offeredItem: { include: { category: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take,
    })

    return {
      matches: matches.map((match) => this.serializeMatch(match)),
      proposals: proposals.map((proposal) => this.serializeProposal(proposal)),
    }
  }

  async updateMatchStatus(
    matchId: string,
    dto: UpdateAdminExchangeMatchStatusDto,
    adminUserId: string,
  ) {
    const match = await this.prismaService.exchangeMatch.findUnique({
      where: { id: matchId },
      include: adminExchangeInclude,
    })

    if (!match) {
      throw new NotFoundException('Exchange match not found')
    }

    const now = new Date()
    const nextProposalStatus =
      dto.status === ExchangeMatchStatus.COMPLETED
        ? ExchangeProposalStatus.ACCEPTED
        : dto.status === ExchangeMatchStatus.EXPIRED
          ? ExchangeProposalStatus.EXPIRED
          : ExchangeProposalStatus.CANCELLED

    await this.prismaService.$transaction(async (tx) => {
      await tx.exchangeMatch.update({
        where: { id: matchId },
        data: {
          status: dto.status as never,
          completedAt:
            dto.status === ExchangeMatchStatus.COMPLETED
              ? match.completedAt ?? now
              : match.completedAt,
          closedAt: now,
          closedByUserId: adminUserId,
          closeReason: dto.reason?.trim() || 'admin_override',
        },
      })
      await tx.exchangeProposal.update({
        where: { id: match.proposalId },
        data: { status: nextProposalStatus as never },
      })
    })

    await Promise.all([
      this.itemsService.syncNegotiationStatus(match.requestedItemId),
      this.itemsService.syncNegotiationStatus(match.offeredItemId),
    ])

    const updated = await this.prismaService.exchangeMatch.findUniqueOrThrow({
      where: { id: matchId },
      include: adminExchangeInclude,
    })

    return this.serializeMatch(updated)
  }

  private serializeMatch(
    match: Prisma.ExchangeMatchGetPayload<{ include: typeof adminExchangeInclude }>,
  ) {
    return {
      id: match.id,
      proposalId: match.proposalId,
      requesterUserId: match.requesterUserId,
      targetUserId: match.targetUserId,
      status: match.status,
      createdAt: match.createdAt,
      updatedAt: match.updatedAt,
      completedAt: match.completedAt,
      closedAt: match.closedAt,
      closeReason: match.closeReason,
      requestedItem: this.serializeItem(match.requestedItem),
      offeredItem: this.serializeItem(match.offeredItem),
      proposal: {
        id: match.proposal.id,
        status: match.proposal.status,
        message: match.proposal.message,
      },
    }
  }

  private serializeProposal(
    proposal: Prisma.ExchangeProposalGetPayload<{
      include: {
        match: true
        requestedItem: { include: { category: true } }
        offeredItem: { include: { category: true } }
      }
    }>,
  ) {
    return {
      id: proposal.id,
      requesterUserId: proposal.requesterUserId,
      targetUserId: proposal.targetUserId,
      status: proposal.status,
      isPublic: proposal.isPublic,
      message: proposal.message,
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
      match: proposal.match,
      requestedItem: this.serializeItem(proposal.requestedItem),
      offeredItem: this.serializeItem(proposal.offeredItem),
    }
  }

  private serializeItem(
    item: Prisma.CatalogItemGetPayload<{ include: { category: true } }>,
  ) {
    return {
      id: item.id,
      ownerUserId: item.ownerUserId,
      title: item.title,
      publicationStatus: item.publicationStatus,
      category: item.category
        ? {
            id: item.category.id,
            name: item.category.name,
            slug: item.category.slug,
          }
        : null,
    }
  }
}
