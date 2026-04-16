import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CatalogItemsService } from './catalog-items.service'
import {
  CatalogItemPublicationStatus,
  ExchangeMatchStatus,
  ExchangeProposalStatus,
} from './catalog.constants'
import { CloseExchangeMatchDto } from './dto/close-exchange-match.dto'
import { CatalogActor } from './interfaces/catalog-actor.interface'

const matchDetailInclude = {
  proposal: true,
  requestedItem: {
    include: {
      category: true,
      images: {
        orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }],
      },
    },
  },
  offeredItem: {
    include: {
      category: true,
      images: {
        orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }],
      },
    },
  },
} satisfies Prisma.ExchangeMatchInclude

type ExchangeMatchWithRelations = Prisma.ExchangeMatchGetPayload<{
  include: typeof matchDetailInclude
}>

@Injectable()
export class ExchangeMatchesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly itemsService: CatalogItemsService
  ) {}

  async listMyMatches(actor: CatalogActor) {
    const matches = await this.prismaService.exchangeMatch.findMany({
      where: {
        OR: [{ requesterUserId: actor.userId }, { targetUserId: actor.userId }],
      },
      include: matchDetailInclude,
      orderBy: [{ updatedAt: 'desc' }],
      take: 50,
    })

    return Promise.all(matches.map(match => this.serializeMatch(match)))
  }

  async markMatchCompleted(
    actor: CatalogActor,
    matchId: string,
    closeExchangeMatchDto: CloseExchangeMatchDto
  ) {
    const match = await this.getMatchOrThrow(matchId)
    this.assertMatchParticipant(actor, match)
    this.assertMatchIsActive(match)

    const now = new Date()
    const closeReason =
      closeExchangeMatchDto.reason?.trim() || 'completed_by_participants'

    const result = await this.prismaService.$transaction(async tx => {
      const pendingProposalsToExpire = await tx.exchangeProposal.findMany({
        where: {
          status: ExchangeProposalStatus.PENDING as never,
          id: {
            not: match.proposalId,
          },
          OR: [
            { requestedItemId: match.requestedItemId },
            { offeredItemId: match.requestedItemId },
            { requestedItemId: match.offeredItemId },
            { offeredItemId: match.offeredItemId },
          ],
        },
        select: {
          id: true,
          requestedItemId: true,
          offeredItemId: true,
        },
      })

      const activeMatchesToCancel = await tx.exchangeMatch.findMany({
        where: {
          status: ExchangeMatchStatus.ACTIVE as never,
          id: {
            not: match.id,
          },
          OR: [
            { requestedItemId: match.requestedItemId },
            { offeredItemId: match.requestedItemId },
            { requestedItemId: match.offeredItemId },
            { offeredItemId: match.offeredItemId },
          ],
        },
        select: {
          id: true,
          proposalId: true,
          requestedItemId: true,
          offeredItemId: true,
        },
      })

      const updatedMatch = await tx.exchangeMatch.update({
        where: {
          id: match.id,
        },
        data: {
          status: ExchangeMatchStatus.COMPLETED as never,
          completedAt: now,
          closedAt: now,
          closedByUserId: actor.userId,
          closeReason,
        },
      })

      await tx.exchangeProposal.update({
        where: {
          id: match.proposalId,
        },
        data: {
          status: ExchangeProposalStatus.ACCEPTED as never,
        },
      })

      await tx.catalogItem.updateMany({
        where: {
          id: {
            in: [match.requestedItemId, match.offeredItemId],
          },
          deletedAt: null,
        },
        data: {
          publicationStatus: CatalogItemPublicationStatus.EXCHANGED as never,
        },
      })

      if (pendingProposalsToExpire.length > 0) {
        await tx.exchangeProposal.updateMany({
          where: {
            id: {
              in: pendingProposalsToExpire.map(proposal => proposal.id),
            },
          },
          data: {
            status: ExchangeProposalStatus.EXPIRED as never,
          },
        })
      }

      if (activeMatchesToCancel.length > 0) {
        await tx.exchangeMatch.updateMany({
          where: {
            id: {
              in: activeMatchesToCancel.map(activeMatch => activeMatch.id),
            },
          },
          data: {
            status: ExchangeMatchStatus.CANCELLED as never,
            closedAt: now,
            closedByUserId: actor.userId,
            closeReason: 'cancelled_because_item_exchanged',
          },
        })

        await tx.exchangeProposal.updateMany({
          where: {
            id: {
              in: activeMatchesToCancel.map(
                activeMatch => activeMatch.proposalId
              ),
            },
          },
          data: {
            status: ExchangeProposalStatus.CANCELLED as never,
          },
        })
      }

      return {
        updatedMatch,
        affectedItemIds: [
          match.requestedItemId,
          match.offeredItemId,
          ...pendingProposalsToExpire.flatMap(proposal => [
            proposal.requestedItemId,
            proposal.offeredItemId,
          ]),
          ...activeMatchesToCancel.flatMap(activeMatch => [
            activeMatch.requestedItemId,
            activeMatch.offeredItemId,
          ]),
        ],
      }
    })

    const affectedItemIds = Array.from(new Set(result.affectedItemIds))

    await Promise.all(
      affectedItemIds.map(itemId =>
        this.itemsService.syncNegotiationStatus(itemId)
      )
    )

    const refreshedMatch = await this.getMatchOrThrow(result.updatedMatch.id)
    this.onMatchLifecycleEvent('match_completed', refreshedMatch)
    return this.serializeMatch(refreshedMatch)
  }

  async markMatchNotConcreted(
    actor: CatalogActor,
    matchId: string,
    closeExchangeMatchDto: CloseExchangeMatchDto
  ) {
    return this.closeActiveMatch(actor, matchId, {
      nextMatchStatus: ExchangeMatchStatus.NOT_CONCRETED,
      nextProposalStatus: ExchangeProposalStatus.CANCELLED,
      defaultReason: 'not_concreted',
      requestedReason: closeExchangeMatchDto.reason,
    })
  }

  async cancelMatch(
    actor: CatalogActor,
    matchId: string,
    closeExchangeMatchDto: CloseExchangeMatchDto
  ) {
    return this.closeActiveMatch(actor, matchId, {
      nextMatchStatus: ExchangeMatchStatus.CANCELLED,
      nextProposalStatus: ExchangeProposalStatus.CANCELLED,
      defaultReason: 'cancelled_by_participant',
      requestedReason: closeExchangeMatchDto.reason,
    })
  }

  async expireMatch(
    actor: CatalogActor,
    matchId: string,
    closeExchangeMatchDto: CloseExchangeMatchDto
  ) {
    return this.closeActiveMatch(actor, matchId, {
      nextMatchStatus: ExchangeMatchStatus.EXPIRED,
      nextProposalStatus: ExchangeProposalStatus.EXPIRED,
      defaultReason: 'expired',
      requestedReason: closeExchangeMatchDto.reason,
    })
  }

  private async closeActiveMatch(
    actor: CatalogActor,
    matchId: string,
    input: {
      nextMatchStatus: ExchangeMatchStatus
      nextProposalStatus: ExchangeProposalStatus
      defaultReason: string
      requestedReason?: string
    }
  ) {
    const match = await this.getMatchOrThrow(matchId)
    this.assertMatchParticipant(actor, match)
    this.assertMatchIsActive(match)

    const now = new Date()
    const closeReason = input.requestedReason?.trim() || input.defaultReason

    await this.prismaService.$transaction(async tx => {
      await tx.exchangeMatch.update({
        where: {
          id: match.id,
        },
        data: {
          status: input.nextMatchStatus as never,
          closedAt: now,
          closedByUserId: actor.userId,
          closeReason,
        },
      })

      await tx.exchangeProposal.update({
        where: {
          id: match.proposalId,
        },
        data: {
          status: input.nextProposalStatus as never,
        },
      })
    })

    await Promise.all([
      this.itemsService.syncNegotiationStatus(match.requestedItemId),
      this.itemsService.syncNegotiationStatus(match.offeredItemId),
    ])

    const refreshedMatch = await this.getMatchOrThrow(match.id)
    this.onMatchLifecycleEvent('match_closed', refreshedMatch)
    return this.serializeMatch(refreshedMatch)
  }

  private onMatchLifecycleEvent(
    _event: 'match_completed' | 'match_closed',
    _match: ExchangeMatchWithRelations
  ) {
    // Hook reserved for Fase 3+: chat, reputacion y notificaciones basadas en eventos de match.
  }

  private async getMatchOrThrow(matchId: string) {
    const match = await this.prismaService.exchangeMatch.findUnique({
      where: {
        id: matchId,
      },
      include: matchDetailInclude,
    })

    if (!match) {
      throw new NotFoundException('Exchange match not found')
    }

    return match
  }

  private assertMatchParticipant(
    actor: CatalogActor,
    match: Pick<ExchangeMatchWithRelations, 'requesterUserId' | 'targetUserId'>
  ) {
    if (
      actor.userId !== match.requesterUserId &&
      actor.userId !== match.targetUserId
    ) {
      throw new ForbiddenException(
        'Only participants can operate this exchange match'
      )
    }
  }

  private assertMatchIsActive(
    match: Pick<ExchangeMatchWithRelations, 'status'>
  ) {
    if (match.status !== ExchangeMatchStatus.ACTIVE) {
      throw new BadRequestException('Only active matches can be updated')
    }
  }

  private async serializeMatch(match: ExchangeMatchWithRelations) {
    return {
      id: match.id,
      proposalId: match.proposalId,
      requesterUserId: match.requesterUserId,
      targetUserId: match.targetUserId,
      requestedItemId: match.requestedItemId,
      offeredItemId: match.offeredItemId,
      status: match.status,
      createdAt: match.createdAt,
      updatedAt: match.updatedAt,
      completedAt: match.completedAt,
      closedAt: match.closedAt,
      closedByUserId: match.closedByUserId,
      closeReason: match.closeReason,
      expiresAt: match.expiresAt,
      proposal: {
        id: match.proposal.id,
        status: match.proposal.status,
        message: match.proposal.message,
        createdAt: match.proposal.createdAt,
        updatedAt: match.proposal.updatedAt,
      },
      requestedItem: this.serializeItem(match.requestedItem),
      offeredItem: this.serializeItem(match.offeredItem),
    }
  }

  private serializeItem(item: ExchangeMatchWithRelations['requestedItem']) {
    return {
      id: item.id,
      ownerUserId: item.ownerUserId,
      title: item.title,
      slug: item.slug,
      description: item.description,
      condition: item.condition,
      subjectiveValue: item.subjectiveValue,
      exchangePreferences: item.exchangePreferences,
      publicationStatus: item.publicationStatus,
      publishedAt: item.publishedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      deletedAt: item.deletedAt,
      category: {
        id: item.category.id,
        name: item.category.name,
        slug: item.category.slug,
        parentId: item.category.parentId,
        path: item.category.path,
        depth: item.category.depth,
      },
      images: item.images.map(image => ({
        id: image.id,
        storageUrl: image.storageUrl,
        storagePath: image.storagePath,
        sortOrder: image.sortOrder,
        isCover: image.isCover,
        createdAt: image.createdAt,
      })),
    }
  }
}
