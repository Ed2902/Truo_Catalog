import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Request } from 'express'
import { PrismaService } from '../prisma/prisma.service'
import { sanitizePlainText } from '../common/utils/sanitize-text.util'
import { CatalogItemsService } from './catalog-items.service'
import { CatalogNegotiationPolicyService } from './catalog-negotiation-policy.service'
import {
  ExchangeMatchStatus,
  ExchangeProposalStatus,
} from './catalog.constants'
import { CreateExchangeProposalDto } from './dto/create-exchange-proposal.dto'
import { RespondExchangeProposalDto } from './dto/respond-exchange-proposal.dto'
import { CatalogActor } from './interfaces/catalog-actor.interface'

const PROPOSAL_PUBLIC_RESPONSE_SEPARATOR = '\n\n--- RESPUESTA_PUBLICA ---\n\n'

const proposalDetailInclude = {
  match: true,
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
} satisfies Prisma.ExchangeProposalInclude

type ExchangeProposalWithRelations = Prisma.ExchangeProposalGetPayload<{
  include: typeof proposalDetailInclude
}>

@Injectable()
export class ExchangeProposalsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly itemsService: CatalogItemsService,
    private readonly negotiationPolicyService: CatalogNegotiationPolicyService
  ) {}

  async createProposal(
    actor: CatalogActor,
    createExchangeProposalDto: CreateExchangeProposalDto,
    request: Request
  ) {
    const sanitizedMessage =
      createExchangeProposalDto.message !== undefined
        ? sanitizePlainText(createExchangeProposalDto.message, {
            preserveNewLines: true,
          })
        : undefined

    if (
      createExchangeProposalDto.offeredItemId ===
      createExchangeProposalDto.requestedItemId
    ) {
      throw new BadRequestException(
        'Offered item and requested item must be different'
      )
    }

    const offeredItem = await this.itemsService.getOwnedActiveItemOrThrow(
      actor,
      createExchangeProposalDto.offeredItemId
    )
    const requestedItem =
      await this.itemsService.getPublicNegotiableItemOrThrow(
        createExchangeProposalDto.requestedItemId
      )

    if (requestedItem.ownerUserId === actor.userId) {
      throw new BadRequestException(
        'You cannot propose an exchange to yourself'
      )
    }

    await this.negotiationPolicyService.assertPublicationCanReceiveAnotherOffer(
      requestedItem,
      actor.userId,
      actor,
      request
    )

    const hasActiveNegotiationForPair = await this.hasActiveNegotiationForPair(
      actor.userId,
      requestedItem.id,
      offeredItem.id
    )

    const isPublic = createExchangeProposalDto.isPublic ?? true

    if (!isPublic && !actor.isPremium) {
      throw new ForbiddenException(
        'Only premium users can hide exchange proposals from public visibility'
      )
    }

    if (hasActiveNegotiationForPair) {
      throw new ConflictException(
        'An active exchange proposal already exists for this pair of items'
      )
    }

    const proposal = await this.prismaService.exchangeProposal.create({
      data: {
        requesterUserId: actor.userId,
        targetUserId: requestedItem.ownerUserId,
        requestedItemId: requestedItem.id,
        offeredItemId: offeredItem.id,
        isPublic,
        status: ExchangeProposalStatus.PENDING as never,
        message: sanitizedMessage || null,
      } as never,
      include: proposalDetailInclude,
    })

    return this.serializeProposal(proposal)
  }

  async acceptProposal(actor: CatalogActor, proposalId: string) {
    const proposal = await this.getProposalOrThrow(proposalId)

    if (proposal.targetUserId !== actor.userId) {
      throw new ForbiddenException('Only the target user can accept a proposal')
    }

    if (proposal.status !== ExchangeProposalStatus.PENDING) {
      throw new BadRequestException('Only pending proposals can be accepted')
    }

    const acceptedProposalExists =
      await this.prismaService.exchangeProposal.findFirst({
        where: {
          requestedItemId: proposal.requestedItemId,
          status: ExchangeProposalStatus.ACCEPTED as never,
          match: {
            isNot: null,
          },
        },
        select: {
          id: true,
        },
      })

    if (acceptedProposalExists) {
      throw new ConflictException(
        'This publication already has an accepted offer and cannot accept another one'
      )
    }

    const updatedProposal = await this.prismaService.$transaction(async tx => {
      const acceptedProposal = await tx.exchangeProposal.update({
        where: {
          id: proposalId,
        },
        data: {
          status: ExchangeProposalStatus.ACCEPTED as never,
        },
        include: proposalDetailInclude,
      })

      await tx.exchangeMatch.create({
        data: {
          proposalId: acceptedProposal.id,
          requesterUserId: acceptedProposal.requesterUserId,
          targetUserId: acceptedProposal.targetUserId,
          requestedItemId: acceptedProposal.requestedItemId,
          offeredItemId: acceptedProposal.offeredItemId,
          status: ExchangeMatchStatus.ACTIVE as never,
        },
      })

      return tx.exchangeProposal.findUniqueOrThrow({
        where: {
          id: proposalId,
        },
        include: proposalDetailInclude,
      })
    })

    await Promise.all([
      this.itemsService.syncNegotiationStatus(updatedProposal.offeredItemId),
      this.itemsService.syncNegotiationStatus(updatedProposal.requestedItemId),
    ])

    if (updatedProposal.match) {
      this.onMatchLifecycleEvent('match_created', updatedProposal.match.id)
    }

    return this.serializeProposal(updatedProposal)
  }

  async rejectProposal(actor: CatalogActor, proposalId: string) {
    const proposal = await this.getProposalOrThrow(proposalId)

    if (proposal.targetUserId !== actor.userId) {
      throw new ForbiddenException('Only the target user can reject a proposal')
    }

    if (proposal.status !== ExchangeProposalStatus.PENDING) {
      throw new BadRequestException('Only pending proposals can be rejected')
    }

    const updatedProposal = await this.prismaService.exchangeProposal.update({
      where: {
        id: proposalId,
      },
      data: {
        status: ExchangeProposalStatus.REJECTED as never,
      },
      include: proposalDetailInclude,
    })

    await Promise.all([
      this.itemsService.syncNegotiationStatus(updatedProposal.offeredItemId),
      this.itemsService.syncNegotiationStatus(updatedProposal.requestedItemId),
    ])

    return this.serializeProposal(updatedProposal)
  }

  async cancelProposal(actor: CatalogActor, proposalId: string) {
    const proposal = await this.getProposalOrThrow(proposalId)

    if (proposal.requesterUserId !== actor.userId) {
      throw new ForbiddenException(
        'Only the requester can cancel this proposal'
      )
    }

    if (
      ![
        ExchangeProposalStatus.PENDING,
        ExchangeProposalStatus.ACCEPTED,
      ].includes(proposal.status as ExchangeProposalStatus)
    ) {
      throw new BadRequestException(
        'Only pending or accepted proposals can be cancelled'
      )
    }

    const updatedProposal = await this.prismaService.$transaction(async tx => {
      const nextProposal = await tx.exchangeProposal.update({
        where: {
          id: proposalId,
        },
        data: {
          status: ExchangeProposalStatus.CANCELLED as never,
        },
        include: proposalDetailInclude,
      })

      if (proposal.status === ExchangeProposalStatus.ACCEPTED) {
        await tx.exchangeMatch.updateMany({
          where: {
            proposalId,
            status: ExchangeMatchStatus.ACTIVE as never,
          },
          data: {
            status: ExchangeMatchStatus.CANCELLED as never,
            closedAt: new Date(),
            closedByUserId: actor.userId,
            closeReason: 'cancelled_by_requester',
          },
        })
      }

      return tx.exchangeProposal.findUniqueOrThrow({
        where: {
          id: proposalId,
        },
        include: proposalDetailInclude,
      })
    })

    await Promise.all([
      this.itemsService.syncNegotiationStatus(updatedProposal.offeredItemId),
      this.itemsService.syncNegotiationStatus(updatedProposal.requestedItemId),
    ])

    return this.serializeProposal(updatedProposal)
  }

  async respondToProposal(
    actor: CatalogActor,
    proposalId: string,
    respondExchangeProposalDto: RespondExchangeProposalDto
  ) {
    const proposal = await this.getProposalOrThrow(proposalId)

    if (
      proposal.targetUserId !== actor.userId &&
      proposal.requesterUserId !== actor.userId
    ) {
      throw new ForbiddenException(
        'Only participants can respond publicly to this proposal'
      )
    }

    if (
      ![
        ExchangeProposalStatus.PENDING,
        ExchangeProposalStatus.ACCEPTED,
      ].includes(proposal.status as ExchangeProposalStatus)
    ) {
      throw new BadRequestException(
        'Only pending or accepted proposals can receive a public response'
      )
    }

    const sanitizedResponseMessage = sanitizePlainText(
      respondExchangeProposalDto.message,
      {
        preserveNewLines: true,
      }
    ).trim()

    if (!sanitizedResponseMessage) {
      throw new BadRequestException('Response message is required')
    }

    const parsedMessage = this.parseProposalPublicMessage(proposal.message)
    const existingItemReferences = this.extractResponseItemReferences(
      parsedMessage.publicResponseMessage
    )
    const nextItemReferences = this.extractResponseItemReferences(
      sanitizedResponseMessage
    )

    if (
      nextItemReferences.some(nextReference =>
        existingItemReferences.some(
          existingReference => existingReference.itemId === nextReference.itemId
        )
      )
    ) {
      throw new ConflictException(
        'This product has already been used in this negotiation'
      )
    }

    const actorRoleLabel =
      actor.userId === proposal.requesterUserId ? 'Solicitante' : 'Dueno'
    const nextPublicEntry = `${actorRoleLabel}: ${sanitizedResponseMessage}`
    const nextPublicResponseMessage = parsedMessage.publicResponseMessage
      ? `${parsedMessage.publicResponseMessage}\n${nextPublicEntry}`
      : nextPublicEntry

    const updatedProposal = await this.prismaService.exchangeProposal.update({
      where: {
        id: proposalId,
      },
      data: {
        message: this.composeProposalPublicMessage(
          proposal.message,
          nextPublicResponseMessage
        ),
      },
      include: proposalDetailInclude,
    })

    return this.serializeProposal(updatedProposal)
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
    })

    return Promise.all(
      proposals.map(proposal => this.serializeProposal(proposal))
    )
  }

  async listPublicProposalsForRequestedItem(
    itemId: string,
    actor?: CatalogActor | null
  ) {
    const proposals = await this.prismaService.exchangeProposal.findMany({
      where: {
        requestedItemId: itemId,
        status: {
          in: [
            ExchangeProposalStatus.PENDING,
            ExchangeProposalStatus.ACCEPTED,
          ] as never,
        },
        ...(actor?.isPremium ? {} : { isPublic: true }),
      },
      include: proposalDetailInclude,
      orderBy: [{ updatedAt: 'desc' }],
      take: 50,
    })

    return Promise.all(
      proposals.map(proposal => this.serializeProposal(proposal))
    )
  }

  private async getProposalOrThrow(proposalId: string) {
    const proposal = await this.prismaService.exchangeProposal.findUnique({
      where: {
        id: proposalId,
      },
      include: proposalDetailInclude,
    })

    if (!proposal) {
      throw new NotFoundException('Exchange proposal not found')
    }

    return proposal
  }

  private async hasActiveNegotiationForPair(
    requesterUserId: string,
    requestedItemId: string,
    offeredItemId: string
  ) {
    const [pendingProposal, activeMatch] = await Promise.all([
      this.prismaService.exchangeProposal.findFirst({
        where: {
          requesterUserId,
          requestedItemId,
          offeredItemId,
          OR: [
            {
              status: ExchangeProposalStatus.PENDING as never,
            },
            {
              status: ExchangeProposalStatus.ACCEPTED as never,
              match: null,
            },
          ],
        },
        select: {
          id: true,
        },
      }),
      this.prismaService.exchangeMatch.findFirst({
        where: {
          requesterUserId,
          requestedItemId,
          offeredItemId,
          status: ExchangeMatchStatus.ACTIVE as never,
        },
        select: {
          id: true,
        },
      }),
    ])

    return Boolean(pendingProposal || activeMatch)
  }

  private async serializeProposal(proposal: ExchangeProposalWithRelations) {
    const parsedPublicMessage = this.parseProposalPublicMessage(
      proposal.message
    )

    return {
      id: proposal.id,
      requesterUserId: proposal.requesterUserId,
      targetUserId: proposal.targetUserId,
      requestedItemId: proposal.requestedItemId,
      offeredItemId: proposal.offeredItemId,
      isPublic:
        (proposal as ExchangeProposalWithRelations & { isPublic?: boolean })
          .isPublic ?? true,
      status: proposal.status,
      message: proposal.message,
      proposalMessage: parsedPublicMessage.proposalMessage,
      publicResponseMessage: parsedPublicMessage.publicResponseMessage,
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
      match: proposal.match
        ? {
            id: proposal.match.id,
            status: proposal.match.status,
            createdAt: proposal.match.createdAt,
            updatedAt: proposal.match.updatedAt,
            completedAt: proposal.match.completedAt,
            closedAt: proposal.match.closedAt,
            closedByUserId: proposal.match.closedByUserId,
            closeReason: proposal.match.closeReason,
            expiresAt: proposal.match.expiresAt,
          }
        : null,
      requestedItem: this.serializeProposalItem(proposal.requestedItem),
      offeredItem: this.serializeProposalItem(proposal.offeredItem),
    }
  }

  private onMatchLifecycleEvent(_event: 'match_created', _matchId: string) {
    // Hook reserved for Fase 3+: chat, reputacion y notificaciones basadas en eventos de match.
  }

  private parseProposalPublicMessage(message?: string | null) {
    if (!message) {
      return {
        proposalMessage: null,
        publicResponseMessage: null,
      }
    }

    const separatorIndex = message.indexOf(PROPOSAL_PUBLIC_RESPONSE_SEPARATOR)

    if (separatorIndex === -1) {
      return {
        proposalMessage: message.trim() || null,
        publicResponseMessage: null,
      }
    }

    const proposalMessage = message.slice(0, separatorIndex).trim() || null
    const publicResponseMessage =
      message
        .slice(separatorIndex + PROPOSAL_PUBLIC_RESPONSE_SEPARATOR.length)
        .trim() || null

    return {
      proposalMessage,
      publicResponseMessage,
    }
  }

  private composeProposalPublicMessage(
    currentMessage: string | null,
    publicResponseMessage: string
  ) {
    const parsed = this.parseProposalPublicMessage(currentMessage)

    if (!parsed.proposalMessage) {
      return `${PROPOSAL_PUBLIC_RESPONSE_SEPARATOR}${publicResponseMessage}`.trim()
    }

    return `${parsed.proposalMessage}${PROPOSAL_PUBLIC_RESPONSE_SEPARATOR}${publicResponseMessage}`
  }

  private extractResponseItemReferences(message?: string | null) {
    if (!message) {
      return []
    }

    const references = [...message.matchAll(/\[\[ITEM:([^\]]+)\]\]/gi)]
      .map(match => {
        const marker = match[1]?.trim() || ''

        if (!marker) {
          return null
        }

        const parts = marker.split(':')
        if (parts.length >= 2) {
          return {
            itemType: parts[0].trim().toLowerCase(),
            itemId: parts.slice(1).join(':').trim(),
          }
        }

        return {
          itemType: '',
          itemId: marker,
        }
      })
      .filter((reference): reference is { itemType: string; itemId: string } =>
        Boolean(reference?.itemId)
      )

    return references
  }

  private serializeProposalItem(
    item: ExchangeProposalWithRelations['requestedItem']
  ) {
    return {
      id: item.id,
      ownerUserId: item.ownerUserId,
      title: item.title,
      slug: item.slug,
      description: item.description,
      category: {
        id: item.category.id,
        name: item.category.name,
        slug: item.category.slug,
        parentId: item.category.parentId,
        path: item.category.path,
        depth: item.category.depth,
      },
      condition: item.condition,
      subjectiveValue: item.subjectiveValue,
      exchangePreferences: item.exchangePreferences,
      publicationStatus: item.publicationStatus,
      publishedAt: item.publishedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      deletedAt: item.deletedAt,
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
