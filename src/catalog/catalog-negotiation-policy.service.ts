import { ConflictException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACTIVE_NEGOTIATION_MATCH_STATUSES,
  ACTIVE_NEGOTIATION_PROPOSAL_STATUSES,
  ExchangeProposalStatus,
  FREE_ACTIVE_NEGOTIATION_LIMIT_PER_ITEM,
  FREE_MAX_ACTIVE_OFFERS_PER_PUBLICATION,
  FREE_MAX_DISTINCT_REQUESTERS_PER_PUBLICATION,
} from './catalog.constants';
import { CatalogActor } from './interfaces/catalog-actor.interface';
import { IdentitySignalsService } from './identity/identity-signals.service';

@Injectable()
export class CatalogNegotiationPolicyService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly identitySignalsService: IdentitySignalsService,
  ) {}

  async assertItemCanOpenAnotherNegotiation(
    item: { id: string; ownerUserId: string },
    actor?: CatalogActor,
    request?: Request,
  ) {
    const signals = await this.identitySignalsService.getSignalsForUser(
      item.ownerUserId,
      actor,
      request,
    );
    const activeNegotiationsCount = await this.countActiveNegotiationsForItem(
      item.id,
    );

    if (signals.isPremium) {
      return {
        isPremium: true,
        activeNegotiationsCount,
        limit: null,
      };
    }

    if (
      activeNegotiationsCount >= FREE_ACTIVE_NEGOTIATION_LIMIT_PER_ITEM
    ) {
      throw new ConflictException(
        `Item ${item.id} already reached the free limit of ${FREE_ACTIVE_NEGOTIATION_LIMIT_PER_ITEM} active negotiations`,
      );
    }

    return {
      isPremium: false,
      activeNegotiationsCount,
      limit: FREE_ACTIVE_NEGOTIATION_LIMIT_PER_ITEM,
    };
  }

  async countActiveNegotiationsForItem(itemId: string) {
    const [pendingProposalsCount, acceptedWithoutMatchCount, activeMatchesCount] = await Promise.all([
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
    ]);

    return pendingProposalsCount + acceptedWithoutMatchCount + activeMatchesCount;
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
    });
  }

  async assertPublicationCanReceiveAnotherOffer(
    requestedItem: { id: string; ownerUserId: string },
    requesterUserId: string,
    actor?: CatalogActor,
    request?: Request,
  ) {
    const signals = await this.identitySignalsService.getSignalsForUser(
      requestedItem.ownerUserId,
      actor,
      request,
    );

    if (signals.isPremium) {
      return {
        isPremium: true,
        activeOffersCount: null,
        distinctRequesterCount: null,
        maxOffers: null,
        maxDistinctRequesters: null,
      };
    }

    const activeProposals = await this.prismaService.exchangeProposal.findMany({
      where: {
        requestedItemId: requestedItem.id,
        status: {
          in: [
            ExchangeProposalStatus.PENDING,
            ExchangeProposalStatus.ACCEPTED,
          ] as never,
        },
      },
      select: {
        requesterUserId: true,
      },
    });

    const activeOffersCount = activeProposals.length;
    const distinctRequesterIds = new Set(
      activeProposals.map((proposal) => proposal.requesterUserId),
    );
    const currentDistinctRequesterCount = distinctRequesterIds.size;
    const nextDistinctRequesterCount = distinctRequesterIds.has(requesterUserId)
      ? currentDistinctRequesterCount
      : currentDistinctRequesterCount + 1;

    if (activeOffersCount >= FREE_MAX_ACTIVE_OFFERS_PER_PUBLICATION) {
      throw new ConflictException(
        `Publication ${requestedItem.id} already reached the free limit of ${FREE_MAX_ACTIVE_OFFERS_PER_PUBLICATION} active offers`,
      );
    }

    if (
      nextDistinctRequesterCount >
      FREE_MAX_DISTINCT_REQUESTERS_PER_PUBLICATION
    ) {
      throw new ConflictException(
        `Publication ${requestedItem.id} already reached the free limit of ${FREE_MAX_DISTINCT_REQUESTERS_PER_PUBLICATION} different requesters`,
      );
    }

    return {
      isPremium: false,
      activeOffersCount,
      distinctRequesterCount: currentDistinctRequesterCount,
      maxOffers: FREE_MAX_ACTIVE_OFFERS_PER_PUBLICATION,
      maxDistinctRequesters: FREE_MAX_DISTINCT_REQUESTERS_PER_PUBLICATION,
    };
  }
}
