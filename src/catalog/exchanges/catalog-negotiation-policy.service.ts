import { ConflictException, Injectable } from '@nestjs/common'
import { ExchangeProposalAdUnlockType, Prisma } from '@prisma/client'
import { Request } from 'express'
import { PrismaService } from '../../prisma/prisma.service'
import {
  ACTIVE_NEGOTIATION_MATCH_STATUSES,
  ACTIVE_NEGOTIATION_PROPOSAL_STATUSES,
  ExchangeProposalStatus,
  FREE_ACTIVE_NEGOTIATION_LIMIT_PER_ITEM,
  FREE_MAX_ACTIVE_OUTGOING_OFFERS,
  FREE_MAX_ACTIVE_OFFERS_PER_PUBLICATION,
  FREE_MAX_DISTINCT_TARGET_USERS_PER_REQUESTER,
  FREE_MAX_DISTINCT_REQUESTERS_PER_PUBLICATION,
} from '../shared/catalog.constants'
import { CatalogActor } from '../interfaces/catalog-actor.interface'
import { IdentitySignalsService } from '../identity/identity-signals.service'

type PrismaClientLike = PrismaService | Prisma.TransactionClient

@Injectable()
export class CatalogNegotiationPolicyService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly identitySignalsService: IdentitySignalsService
  ) {}

  async assertItemCanOpenAnotherNegotiation(
    item: { id: string; ownerUserId: string },
    actor?: CatalogActor,
    request?: Request
  ) {
    const signals = await this.identitySignalsService.getSignalsForUser(
      item.ownerUserId,
      actor,
      request
    )
    const activeNegotiationsCount = await this.countActiveNegotiationsForItem(
      item.id
    )

    if (signals.isPremium) {
      return {
        isPremium: true,
        activeNegotiationsCount,
        limit: null,
      }
    }

    if (activeNegotiationsCount >= FREE_ACTIVE_NEGOTIATION_LIMIT_PER_ITEM) {
      throw new ConflictException(
        `Esta publicación gratuita ya alcanzó su límite de ${FREE_ACTIVE_NEGOTIATION_LIMIT_PER_ITEM} negociaciones activas. Activa premium para seguir recibiendo movimiento sin restricciones.`
      )
    }

    return {
      isPremium: false,
      activeNegotiationsCount,
      limit: FREE_ACTIVE_NEGOTIATION_LIMIT_PER_ITEM,
    }
  }

  async assertRequesterCanCreateAnotherOffer(
    requesterUserId: string,
    targetUserId: string,
    actor?: CatalogActor,
    request?: Request,
    prismaClient: PrismaClientLike = this.prismaService
  ) {
    const signals = await this.identitySignalsService.getSignalsForUser(
      requesterUserId,
      actor,
      request
    )

    const accessState = await this.buildOutgoingProposalAccessState(
      requesterUserId,
      targetUserId,
      signals.isPremium,
      prismaClient
    )

    if (accessState.isPremium) {
      return {
        isPremium: true,
        totalOffersCreatedCount: null,
        distinctTargetUsersCount: null,
        maxOffersBeforeAd: null,
        maxDistinctTargetUsers: null,
        requiresAdUnlock: false,
        availableAdUnlocksCount: null,
      }
    }

    if (
      accessState.requiresAdUnlock &&
      accessState.availableAdUnlocksCount <= 0
    ) {
      throw new ConflictException(
        `Tu plan gratuito ya llegó al tope visible de ${FREE_MAX_ACTIVE_OUTGOING_OFFERS} ofertas o ${FREE_MAX_DISTINCT_TARGET_USERS_PER_REQUESTER} personas. Ve un anuncio para habilitar 1 oferta adicional o activa premium.`
      )
    }

    return {
      isPremium: false,
      totalOffersCreatedCount: accessState.totalOffersCreatedCount,
      distinctTargetUsersCount: accessState.distinctTargetUsersCount,
      maxOffersBeforeAd: FREE_MAX_ACTIVE_OUTGOING_OFFERS,
      maxDistinctTargetUsers:
        FREE_MAX_DISTINCT_TARGET_USERS_PER_REQUESTER,
      requiresAdUnlock: accessState.requiresAdUnlock,
      availableAdUnlocksCount: accessState.availableAdUnlocksCount,
    }
  }

  async buildOutgoingProposalAccessState(
    requesterUserId: string,
    targetUserId?: string | null,
    isPremiumUser = false,
    prismaClient: PrismaClientLike = this.prismaService
  ) {
    if (isPremiumUser) {
      return {
        isPremium: true,
        totalOffersCreatedCount: 0,
        distinctTargetUsersCount: 0,
        nextDistinctTargetUsersCount: 0,
        availableAdUnlocksCount: 0,
        requiresAdUnlock: false,
      }
    }

    const [allOutgoingProposals, availableAdUnlocksCount] = await Promise.all([
      prismaClient.exchangeProposal.findMany({
        where: {
          requesterUserId,
        },
        select: {
          targetUserId: true,
        },
      }),
      prismaClient.exchangeProposalAdUnlock.count({
        where: {
          userId: requesterUserId,
          unlockType:
            ExchangeProposalAdUnlockType.OUTGOING_PROPOSAL_CREATE as never,
          consumedAt: null,
        },
      }),
    ])

    const totalOffersCreatedCount = allOutgoingProposals.length
    const distinctTargetUserIds = new Set(
      allOutgoingProposals.map(proposal => proposal.targetUserId)
    )
    const distinctTargetUsersCount = distinctTargetUserIds.size
    const nextDistinctTargetUsersCount = targetUserId
      ? distinctTargetUserIds.has(targetUserId)
        ? distinctTargetUsersCount
        : distinctTargetUsersCount + 1
      : distinctTargetUsersCount
    const requiresAdUnlock =
      totalOffersCreatedCount >= FREE_MAX_ACTIVE_OUTGOING_OFFERS ||
      nextDistinctTargetUsersCount >
        FREE_MAX_DISTINCT_TARGET_USERS_PER_REQUESTER

    return {
      isPremium: false,
      totalOffersCreatedCount,
      distinctTargetUsersCount,
      nextDistinctTargetUsersCount,
      availableAdUnlocksCount,
      requiresAdUnlock,
    }
  }

  async registerOutgoingAdUnlock(userId: string) {
    return this.prismaService.exchangeProposalAdUnlock.create({
      data: {
        userId,
        unlockType:
          ExchangeProposalAdUnlockType.OUTGOING_PROPOSAL_CREATE as never,
      },
    })
  }

  async consumeOutgoingAdUnlock(
    userId: string,
    proposalId: string,
    prismaClient: PrismaClientLike = this.prismaService
  ) {
    const unlock = await prismaClient.exchangeProposalAdUnlock.findFirst({
      where: {
        userId,
        unlockType:
          ExchangeProposalAdUnlockType.OUTGOING_PROPOSAL_CREATE as never,
        consumedAt: null,
      },
      orderBy: {
        createdAt: 'asc',
      },
    })

    if (!unlock) {
      throw new ConflictException(
        'Necesitas ver un anuncio o activar premium para habilitar esta oferta adicional.'
      )
    }

    await prismaClient.exchangeProposalAdUnlock.update({
      where: {
        id: unlock.id,
      },
      data: {
        consumedAt: new Date(),
        consumedByProposalId: proposalId,
      },
    })
  }

  async countActiveNegotiationsForItem(itemId: string) {
    const [
      pendingProposalsCount,
      acceptedWithoutMatchCount,
      activeMatchesCount,
    ] = await Promise.all([
      this.prismaService.exchangeProposal.count({
        where: {
          status: {
            in: [...ACTIVE_NEGOTIATION_PROPOSAL_STATUSES] as never,
          },
          OR: [
            {
              requestedItemId: itemId,
            },
            {
              offeredItemId: itemId,
            },
          ],
        },
      }),
      this.prismaService.exchangeProposal.count({
        where: {
          status: ExchangeProposalStatus.ACCEPTED as never,
          match: null,
          OR: [
            {
              requestedItemId: itemId,
            },
            {
              offeredItemId: itemId,
            },
          ],
        },
      }),
      this.prismaService.exchangeMatch.count({
        where: {
          status: {
            in: [...ACTIVE_NEGOTIATION_MATCH_STATUSES] as never,
          },
          OR: [
            {
              requestedItemId: itemId,
            },
            {
              offeredItemId: itemId,
            },
          ],
        },
      }),
    ])

    return (
      pendingProposalsCount + acceptedWithoutMatchCount + activeMatchesCount
    )
  }

  async countActiveNegotiationsForItems(itemIds: string[]) {
    const uniqueItemIds = [...new Set(itemIds.filter(Boolean))]
    const countsByItemId = new Map<string, number>(
      uniqueItemIds.map(itemId => [itemId, 0])
    )

    if (!uniqueItemIds.length) {
      return countsByItemId
    }

    const [
      pendingRequestedProposals,
      pendingOfferedProposals,
      acceptedRequestedWithoutMatch,
      acceptedOfferedWithoutMatch,
      activeRequestedMatches,
      activeOfferedMatches,
    ] = await Promise.all([
      this.prismaService.exchangeProposal.groupBy({
        by: ['requestedItemId'],
        where: {
          requestedItemId: {
            in: uniqueItemIds,
          },
          status: {
            in: [...ACTIVE_NEGOTIATION_PROPOSAL_STATUSES] as never,
          },
        },
        _count: {
          _all: true,
        },
      }),
      this.prismaService.exchangeProposal.groupBy({
        by: ['offeredItemId'],
        where: {
          offeredItemId: {
            in: uniqueItemIds,
          },
          status: {
            in: [...ACTIVE_NEGOTIATION_PROPOSAL_STATUSES] as never,
          },
        },
        _count: {
          _all: true,
        },
      }),
      this.prismaService.exchangeProposal.groupBy({
        by: ['requestedItemId'],
        where: {
          requestedItemId: {
            in: uniqueItemIds,
          },
          status: ExchangeProposalStatus.ACCEPTED as never,
          match: null,
        },
        _count: {
          _all: true,
        },
      }),
      this.prismaService.exchangeProposal.groupBy({
        by: ['offeredItemId'],
        where: {
          offeredItemId: {
            in: uniqueItemIds,
          },
          status: ExchangeProposalStatus.ACCEPTED as never,
          match: null,
        },
        _count: {
          _all: true,
        },
      }),
      this.prismaService.exchangeMatch.groupBy({
        by: ['requestedItemId'],
        where: {
          requestedItemId: {
            in: uniqueItemIds,
          },
          status: {
            in: [...ACTIVE_NEGOTIATION_MATCH_STATUSES] as never,
          },
        },
        _count: {
          _all: true,
        },
      }),
      this.prismaService.exchangeMatch.groupBy({
        by: ['offeredItemId'],
        where: {
          offeredItemId: {
            in: uniqueItemIds,
          },
          status: {
            in: [...ACTIVE_NEGOTIATION_MATCH_STATUSES] as never,
          },
        },
        _count: {
          _all: true,
        },
      }),
    ])

    const addGroupCounts = <T extends string>(
      groups: Array<Record<T, string> & { _count: { _all: number } }>,
      field: T
    ) => {
      for (const group of groups) {
        countsByItemId.set(
          group[field],
          (countsByItemId.get(group[field]) ?? 0) + group._count._all
        )
      }
    }

    addGroupCounts(pendingRequestedProposals, 'requestedItemId')
    addGroupCounts(pendingOfferedProposals, 'offeredItemId')
    addGroupCounts(acceptedRequestedWithoutMatch, 'requestedItemId')
    addGroupCounts(acceptedOfferedWithoutMatch, 'offeredItemId')
    addGroupCounts(activeRequestedMatches, 'requestedItemId')
    addGroupCounts(activeOfferedMatches, 'offeredItemId')

    return countsByItemId
  }

  countActiveProposalsForItem(itemId: string) {
    return this.prismaService.exchangeProposal.count({
      where: {
        status: {
          in: [...ACTIVE_NEGOTIATION_PROPOSAL_STATUSES] as never,
        },
        OR: [
          {
            requestedItemId: itemId,
          },
          {
            offeredItemId: itemId,
          },
        ],
      },
    })
  }

  async assertPublicationCanReceiveAnotherOffer(
    requestedItem: { id: string; ownerUserId: string },
    requesterUserId: string,
    actor?: CatalogActor,
    request?: Request
  ) {
    const signals = await this.identitySignalsService.getSignalsForUser(
      requestedItem.ownerUserId,
      actor,
      request
    )

    if (signals.isPremium) {
      return {
        isPremium: true,
        totalOffersCount: null,
        hiddenOffersCount: null,
        visibleOffersCount: null,
        unlockedOffersCount: null,
      }
    }

    const accessState = await this.buildIncomingProposalAccessState(
      requestedItem.id,
      requestedItem.ownerUserId
    )

    return {
      isPremium: false,
      totalOffersCount: accessState.totalOffersReceivedCount,
      hiddenOffersCount: accessState.hiddenOffersCount,
      visibleOffersCount: accessState.visibleOffersCount,
      unlockedOffersCount: accessState.unlockedOffersCount,
    }
  }

  async buildIncomingProposalAccessState(
    requestedItemId: string,
    userId: string,
    isPremiumUser = false,
    prismaClient: PrismaClientLike = this.prismaService
  ) {
    const proposals = await prismaClient.exchangeProposal.findMany({
      where: {
        requestedItemId,
        targetUserId: userId,
      },
      select: {
        id: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    })

    if (isPremiumUser) {
      return {
        requestedItemId,
        totalOffersReceivedCount: proposals.length,
        visibleOffersCount: proposals.length,
        hiddenOffersCount: 0,
        unlockedOffersCount: 0,
        freeVisibleLimit: FREE_MAX_ACTIVE_OFFERS_PER_PUBLICATION,
        canUnlockNextOfferWithAd: false,
      }
    }

    const baseVisibleProposalIds = new Set(
      proposals
        .slice(0, FREE_MAX_ACTIVE_OFFERS_PER_PUBLICATION)
        .map(proposal => proposal.id)
    )
    const unlockedProposals = await prismaClient.exchangeProposalAdUnlock.findMany({
      where: {
        userId,
        requestedItemId,
        unlockType:
          ExchangeProposalAdUnlockType.INCOMING_PROPOSAL_VIEW as never,
        proposalId: {
          not: null,
        },
      },
      select: {
        proposalId: true,
      },
    })
    const unlockedProposalIds = new Set(
      unlockedProposals
        .map(unlock => unlock.proposalId)
        .filter((proposalId): proposalId is string => Boolean(proposalId))
    )
    const visibleProposalIds = new Set([
      ...baseVisibleProposalIds,
      ...unlockedProposalIds,
    ])

    return {
      requestedItemId,
      totalOffersReceivedCount: proposals.length,
      visibleOffersCount: Math.min(visibleProposalIds.size, proposals.length),
      hiddenOffersCount: Math.max(0, proposals.length - visibleProposalIds.size),
      unlockedOffersCount: Math.max(
        0,
        visibleProposalIds.size - FREE_MAX_ACTIVE_OFFERS_PER_PUBLICATION
      ),
      freeVisibleLimit: FREE_MAX_ACTIVE_OFFERS_PER_PUBLICATION,
      canUnlockNextOfferWithAd: proposals.length > visibleProposalIds.size,
    }
  }

  async listVisibleIncomingProposalIdsForUser(
    userId: string,
    prismaClient: PrismaClientLike = this.prismaService
  ) {
    const proposals = await prismaClient.exchangeProposal.findMany({
      where: {
        targetUserId: userId,
      },
      select: {
        id: true,
        requestedItemId: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    })

    const unlockedProposals = await prismaClient.exchangeProposalAdUnlock.findMany({
      where: {
        userId,
        unlockType:
          ExchangeProposalAdUnlockType.INCOMING_PROPOSAL_VIEW as never,
        proposalId: {
          not: null,
        },
      },
      select: {
        proposalId: true,
      },
    })
    const unlockedProposalIds = new Set(
      unlockedProposals
        .map(unlock => unlock.proposalId)
        .filter((proposalId): proposalId is string => Boolean(proposalId))
    )
    const visibleProposalIds = new Set<string>()
    const visibleCountByItem = new Map<string, number>()

    for (const proposal of proposals) {
      const currentVisibleCount =
        visibleCountByItem.get(proposal.requestedItemId) ?? 0
      const shouldBeBaseVisible =
        currentVisibleCount < FREE_MAX_ACTIVE_OFFERS_PER_PUBLICATION

      if (shouldBeBaseVisible || unlockedProposalIds.has(proposal.id)) {
        visibleProposalIds.add(proposal.id)
      }

      if (visibleProposalIds.has(proposal.id)) {
        visibleCountByItem.set(proposal.requestedItemId, currentVisibleCount + 1)
      }
    }

    return visibleProposalIds
  }

  async unlockNextIncomingProposal(
    requestedItemId: string,
    userId: string,
    prismaClient: PrismaClientLike = this.prismaService
  ) {
    const proposals = await prismaClient.exchangeProposal.findMany({
      where: {
        requestedItemId,
        targetUserId: userId,
      },
      select: {
        id: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    })

    const baseVisibleProposalIds = new Set(
      proposals
        .slice(0, FREE_MAX_ACTIVE_OFFERS_PER_PUBLICATION)
        .map(proposal => proposal.id)
    )
    const unlockedProposals = await prismaClient.exchangeProposalAdUnlock.findMany({
      where: {
        userId,
        requestedItemId,
        unlockType:
          ExchangeProposalAdUnlockType.INCOMING_PROPOSAL_VIEW as never,
        proposalId: {
          not: null,
        },
      },
      select: {
        proposalId: true,
      },
    })
    const unlockedProposalIds = new Set(
      unlockedProposals
        .map(unlock => unlock.proposalId)
        .filter((proposalId): proposalId is string => Boolean(proposalId))
    )
    const nextHiddenProposal = proposals.find(
      proposal =>
        !baseVisibleProposalIds.has(proposal.id) &&
        !unlockedProposalIds.has(proposal.id)
    )

    if (!nextHiddenProposal) {
      throw new ConflictException(
        'No tienes más ofertas ocultas para desbloquear en esta publicación.'
      )
    }

    await prismaClient.exchangeProposalAdUnlock.create({
      data: {
        userId,
        requestedItemId,
        proposalId: nextHiddenProposal.id,
        unlockType:
          ExchangeProposalAdUnlockType.INCOMING_PROPOSAL_VIEW as never,
      },
    })

    return nextHiddenProposal.id
  }
}
