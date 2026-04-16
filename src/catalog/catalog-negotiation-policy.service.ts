import { ConflictException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACTIVE_NEGOTIATION_PROPOSAL_STATUSES,
  FREE_ACTIVE_NEGOTIATION_LIMIT_PER_ITEM,
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

  countActiveNegotiationsForItem(itemId: string) {
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
}
