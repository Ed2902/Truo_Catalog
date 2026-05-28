import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogItemsService } from './catalog-items.service';
import { CatalogNegotiationPolicyService } from './catalog-negotiation-policy.service';
import { ExchangeProposalStatus } from './catalog.constants';
import { CreateExchangeProposalDto } from './dto/create-exchange-proposal.dto';
import { CatalogActor } from './interfaces/catalog-actor.interface';

const proposalDetailInclude = {
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
} satisfies Prisma.ExchangeProposalInclude;

type ExchangeProposalWithRelations = Prisma.ExchangeProposalGetPayload<{
  include: typeof proposalDetailInclude;
}>;

@Injectable()
export class ExchangeProposalsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly itemsService: CatalogItemsService,
    private readonly negotiationPolicyService: CatalogNegotiationPolicyService,
  ) {}

  async createProposal(
    actor: CatalogActor,
    createExchangeProposalDto: CreateExchangeProposalDto,
    request: Request,
  ) {
    if (
      createExchangeProposalDto.offeredItemId ===
      createExchangeProposalDto.requestedItemId
    ) {
      throw new BadRequestException(
        'Offered item and requested item must be different',
      );
    }

    const offeredItem = await this.itemsService.getOwnedActiveItemOrThrow(
      actor,
      createExchangeProposalDto.offeredItemId,
    );
    const requestedItem = await this.itemsService.getPublicNegotiableItemOrThrow(
      createExchangeProposalDto.requestedItemId,
    );

    if (requestedItem.ownerUserId === actor.userId) {
      throw new BadRequestException('You cannot propose an exchange to yourself');
    }

    await this.negotiationPolicyService.assertItemCanOpenAnotherNegotiation(
      offeredItem,
      actor,
      request,
    );
    await this.negotiationPolicyService.assertItemCanOpenAnotherNegotiation(
      requestedItem,
      actor,
      request,
    );

    const existingActiveProposal = await this.prismaService.exchangeProposal.findFirst({
      where: {
        requesterUserId: actor.userId,
        requestedItemId: requestedItem.id,
        offeredItemId: offeredItem.id,
        status: {
          in: [ExchangeProposalStatus.PENDING, ExchangeProposalStatus.ACCEPTED] as never,
        },
      },
      select: {
        id: true,
      },
    });

    if (existingActiveProposal) {
      throw new ConflictException(
        'An active exchange proposal already exists for this pair of items',
      );
    }

    const proposal = await this.prismaService.exchangeProposal.create({
      data: {
        requesterUserId: actor.userId,
        targetUserId: requestedItem.ownerUserId,
        requestedItemId: requestedItem.id,
        offeredItemId: offeredItem.id,
        status: ExchangeProposalStatus.PENDING as never,
        message: createExchangeProposalDto.message?.trim() || null,
      },
      include: proposalDetailInclude,
    });

    return this.serializeProposal(proposal);
  }

  async acceptProposal(actor: CatalogActor, proposalId: string) {
    const proposal = await this.getProposalOrThrow(proposalId);

    if (proposal.targetUserId !== actor.userId) {
      throw new ForbiddenException('Only the target user can accept a proposal');
    }

    if (proposal.status !== ExchangeProposalStatus.PENDING) {
      throw new BadRequestException('Only pending proposals can be accepted');
    }

    const updatedProposal = await this.prismaService.exchangeProposal.update({
      where: {
        id: proposalId,
      },
      data: {
        status: ExchangeProposalStatus.ACCEPTED as never,
      },
      include: proposalDetailInclude,
    });

    await Promise.all([
      this.itemsService.syncNegotiationStatus(updatedProposal.offeredItemId),
      this.itemsService.syncNegotiationStatus(updatedProposal.requestedItemId),
    ]);

    return {
      ...(await this.serializeProposal(updatedProposal)),
      matchReady: true,
      matchStatus: 'PENDING_IMPLEMENTATION',
    };
  }

  async rejectProposal(actor: CatalogActor, proposalId: string) {
    const proposal = await this.getProposalOrThrow(proposalId);

    if (proposal.targetUserId !== actor.userId) {
      throw new ForbiddenException('Only the target user can reject a proposal');
    }

    if (proposal.status !== ExchangeProposalStatus.PENDING) {
      throw new BadRequestException('Only pending proposals can be rejected');
    }

    const updatedProposal = await this.prismaService.exchangeProposal.update({
      where: {
        id: proposalId,
      },
      data: {
        status: ExchangeProposalStatus.REJECTED as never,
      },
      include: proposalDetailInclude,
    });

    await Promise.all([
      this.itemsService.syncNegotiationStatus(updatedProposal.offeredItemId),
      this.itemsService.syncNegotiationStatus(updatedProposal.requestedItemId),
    ]);

    return this.serializeProposal(updatedProposal);
  }

  async cancelProposal(actor: CatalogActor, proposalId: string) {
    const proposal = await this.getProposalOrThrow(proposalId);

    if (proposal.requesterUserId !== actor.userId) {
      throw new ForbiddenException(
        'Only the requester can cancel this proposal',
      );
    }

    if (
      ![ExchangeProposalStatus.PENDING, ExchangeProposalStatus.ACCEPTED].includes(
        proposal.status as ExchangeProposalStatus,
      )
    ) {
      throw new BadRequestException(
        'Only pending or accepted proposals can be cancelled',
      );
    }

    const updatedProposal = await this.prismaService.exchangeProposal.update({
      where: {
        id: proposalId,
      },
      data: {
        status: ExchangeProposalStatus.CANCELLED as never,
      },
      include: proposalDetailInclude,
    });

    await Promise.all([
      this.itemsService.syncNegotiationStatus(updatedProposal.offeredItemId),
      this.itemsService.syncNegotiationStatus(updatedProposal.requestedItemId),
    ]);

    return this.serializeProposal(updatedProposal);
  }

  async listMyProposals(actor: CatalogActor) {
    const proposals = await this.prismaService.exchangeProposal.findMany({
      where: {
        OR: [
          {
            requesterUserId: actor.userId,
          },
          {
            targetUserId: actor.userId,
          },
        ],
      },
      include: proposalDetailInclude,
      orderBy: [{ updatedAt: 'desc' }],
      take: 50,
    });

    return Promise.all(proposals.map((proposal) => this.serializeProposal(proposal)));
  }

  private async getProposalOrThrow(proposalId: string) {
    const proposal = await this.prismaService.exchangeProposal.findUnique({
      where: {
        id: proposalId,
      },
      include: proposalDetailInclude,
    });

    if (!proposal) {
      throw new NotFoundException('Exchange proposal not found');
    }

    return proposal;
  }

  private async serializeProposal(proposal: ExchangeProposalWithRelations) {
    return {
      id: proposal.id,
      requesterUserId: proposal.requesterUserId,
      targetUserId: proposal.targetUserId,
      requestedItemId: proposal.requestedItemId,
      offeredItemId: proposal.offeredItemId,
      status: proposal.status,
      message: proposal.message,
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
      requestedItem: await this.itemsService.getItemDetail(proposal.requestedItemId, {
        userId: proposal.targetUserId,
        isPremium: false,
      }),
      offeredItem: await this.itemsService.getItemDetail(proposal.offeredItemId, {
        userId: proposal.requesterUserId,
        isPremium: false,
      }),
    };
  }
}
