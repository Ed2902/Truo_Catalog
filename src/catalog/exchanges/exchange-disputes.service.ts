import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { NotificationsApiService } from '../../common/notifications-api.service'
import {
  ExchangeDisputeMessageSenderType,
  ExchangeDisputeStatus,
  ExchangeMatchStatus,
  ExchangeProposalStatus,
} from '../shared/catalog.constants'
import { AddExchangeDisputeMessageDto } from '../dto/add-exchange-dispute-message.dto'
import { CreateExchangeDisputeDto } from '../dto/create-exchange-dispute.dto'
import { ListExchangeDisputesQueryDto } from '../dto/list-exchange-disputes-query.dto'
import { UpdateAdminExchangeDisputeDto } from '../dto/update-admin-exchange-dispute.dto'
import { CatalogActor } from '../interfaces/catalog-actor.interface'
import { PrismaService } from '../../prisma/prisma.service'

const disputeInclude = {
  match: {
    include: {
      proposal: true,
    },
  },
  requestedItem: {
    include: {
      category: true,
    },
  },
  offeredItem: {
    include: {
      category: true,
    },
  },
  messages: {
    orderBy: [{ createdAt: 'asc' }],
    take: 200,
  },
} satisfies Prisma.ExchangeDisputeInclude

const matchForDisputeInclude = {
  proposal: true,
  requestedItem: {
    include: {
      category: true,
    },
  },
  offeredItem: {
    include: {
      category: true,
    },
  },
} satisfies Prisma.ExchangeMatchInclude

type ExchangeDisputeWithRelations = Prisma.ExchangeDisputeGetPayload<{
  include: typeof disputeInclude
}>

type ExchangeMatchForDispute = Prisma.ExchangeMatchGetPayload<{
  include: typeof matchForDisputeInclude
}>

@Injectable()
export class ExchangeDisputesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly notificationsApiService: NotificationsApiService,
  ) {}

  async createDispute(actor: CatalogActor, dto: CreateExchangeDisputeDto) {
    const match = await this.getMatchForDisputeOrThrow(dto.matchId)
    this.assertMatchParticipant(actor.userId, match)

    const existingOpenDispute = await this.safeExchangeDisputeFindFirst({
      where: {
        matchId: match.id,
        status: {
          in: [
            ExchangeDisputeStatus.OPEN as never,
            ExchangeDisputeStatus.IN_REVIEW as never,
          ],
        },
      },
    })

    if (existingOpenDispute) {
      throw new BadRequestException('This exchange already has an open dispute')
    }

    try {
      const dispute = await this.prismaService.exchangeDispute.create({
        data: {
          matchId: match.id,
          proposalId: match.proposalId,
          openedByUserId: actor.userId,
          requesterUserId: match.requesterUserId,
          targetUserId: match.targetUserId,
          requestedItemId: match.requestedItemId,
          offeredItemId: match.offeredItemId,
          status: ExchangeDisputeStatus.OPEN as never,
          reason: dto.reason as never,
          title: dto.title.trim(),
          description: dto.description.trim(),
          messages: {
            create: {
              senderType: ExchangeDisputeMessageSenderType.USER as never,
              senderUserId: actor.userId,
              text: dto.description.trim(),
            },
          },
        },
        include: disputeInclude,
      })

      await this.notifyParticipants(dispute, {
        title: 'Se abrió una disputa',
        body: `La disputa "${dispute.title}" está lista para revisión.`,
        priority: 'HIGH',
        sourceEvent: 'catalog.dispute_opened',
      })

      return this.serializeDispute(dispute)
    } catch (error) {
      this.throwIfMissingDisputeTable(error)
      throw error
    }
  }

  async listMyDisputes(actor: CatalogActor) {
    const disputes = await this.safeExchangeDisputeFindMany({
      where: {
        OR: [{ requesterUserId: actor.userId }, { targetUserId: actor.userId }],
      },
      include: disputeInclude,
      orderBy: [{ updatedAt: 'desc' }],
      take: 50,
    })

    return disputes.map((dispute) => this.serializeDisputeForUser(dispute))
  }

  async getMyDispute(actor: CatalogActor, disputeId: string) {
    const dispute = await this.getDisputeOrThrow(disputeId)
    this.assertDisputeParticipant(actor.userId, dispute)
    return this.serializeDisputeForUser(dispute)
  }

  async addUserMessage(
    actor: CatalogActor,
    disputeId: string,
    dto: AddExchangeDisputeMessageDto,
  ) {
    const dispute = await this.getDisputeOrThrow(disputeId)
    this.assertDisputeParticipant(actor.userId, dispute)
    this.assertDisputeCanReceiveMessages(dispute)

    try {
      const updated = await this.prismaService.exchangeDispute.update({
        where: { id: disputeId },
        data: {
          status:
            dispute.status === ExchangeDisputeStatus.OPEN
              ? (ExchangeDisputeStatus.IN_REVIEW as never)
              : (dispute.status as never),
          messages: {
            create: {
              senderType: ExchangeDisputeMessageSenderType.USER as never,
              senderUserId: actor.userId,
              text: dto.text.trim(),
            },
          },
        },
        include: disputeInclude,
      })

      await this.notifyParticipants(updated, {
        exceptUserId: actor.userId,
        title: 'Nuevo mensaje en una disputa',
        body: `Hay una respuesta en "${updated.title}".`,
        priority: 'HIGH',
        sourceEvent: 'catalog.dispute_user_message',
      })

      return this.serializeDisputeForUser(updated)
    } catch (error) {
      this.throwIfMissingDisputeTable(error)
      throw error
    }
  }

  async listAdminDisputes(query: ListExchangeDisputesQueryDto) {
    const take = query.take ?? 50
    const search = query.q?.trim()
    const disputes = await this.safeExchangeDisputeFindMany({
      where: {
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.matchId ? { matchId: query.matchId } : {}),
        ...(query.userId
          ? {
              OR: [
                { requesterUserId: query.userId },
                { targetUserId: query.userId },
                { openedByUserId: query.userId },
              ],
            }
          : {}),
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
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
      include: disputeInclude,
      orderBy: [{ updatedAt: 'desc' }],
      take,
    })

    return disputes.map((dispute) => this.serializeDispute(dispute))
  }

  async getAdminDispute(disputeId: string) {
    const dispute = await this.getDisputeOrThrow(disputeId)
    return this.serializeDispute(dispute)
  }

  async addAdminMessage(
    adminUserId: string,
    disputeId: string,
    dto: AddExchangeDisputeMessageDto,
  ) {
    const dispute = await this.getDisputeOrThrow(disputeId)
    this.assertDisputeCanReceiveMessages(dispute)

    try {
      const updated = await this.prismaService.exchangeDispute.update({
        where: { id: disputeId },
        data: {
          status:
            dispute.status === ExchangeDisputeStatus.OPEN
              ? (ExchangeDisputeStatus.IN_REVIEW as never)
              : (dispute.status as never),
          assignedAdminUserId: dispute.assignedAdminUserId ?? adminUserId,
          messages: {
            create: {
              senderType: ExchangeDisputeMessageSenderType.ADMIN as never,
              senderAdminUserId: adminUserId,
              text: dto.text.trim(),
              isInternalNote: dto.isInternalNote ?? false,
            },
          },
        },
        include: disputeInclude,
      })

      if (!dto.isInternalNote) {
        await this.notifyParticipants(updated, {
          title: 'Soporte respondió tu disputa',
          body: `Hay una respuesta del equipo en "${updated.title}".`,
          priority: 'HIGH',
          sourceEvent: 'catalog.dispute_admin_message',
        })
      }

      return this.serializeDispute(updated)
    } catch (error) {
      this.throwIfMissingDisputeTable(error)
      throw error
    }
  }

  async updateAdminDispute(
    adminUserId: string,
    disputeId: string,
    dto: UpdateAdminExchangeDisputeDto,
  ) {
    const dispute = await this.getDisputeOrThrow(disputeId)
    const now = new Date()
    const nextStatus = dto.status ?? dispute.status
    const shouldResolve =
      nextStatus === ExchangeDisputeStatus.RESOLVED ||
      nextStatus === ExchangeDisputeStatus.CLOSED

    await this.prismaService.$transaction(async (tx) => {
      try {
        await tx.exchangeDispute.update({
          where: { id: disputeId },
          data: {
            status: nextStatus as never,
            assignedAdminUserId:
              dto.assignedAdminUserId?.trim() ||
              dispute.assignedAdminUserId ||
              adminUserId,
            resolution: dto.resolution?.trim() || dispute.resolution,
            resolvedByAdminUserId: shouldResolve
              ? dispute.resolvedByAdminUserId ?? adminUserId
              : dispute.resolvedByAdminUserId,
            resolvedAt: shouldResolve
              ? dispute.resolvedAt ?? now
              : dispute.resolvedAt,
            closedAt:
              nextStatus === ExchangeDisputeStatus.CLOSED
                ? dispute.closedAt ?? now
                : dispute.closedAt,
            ...(dto.resolution?.trim()
              ? {
                  messages: {
                    create: {
                      senderType: ExchangeDisputeMessageSenderType.SYSTEM as never,
                      senderAdminUserId: adminUserId,
                      text: `Resolución: ${dto.resolution.trim()}`,
                    },
                  },
                }
              : {}),
          },
        })
      } catch (error) {
        this.throwIfMissingDisputeTable(error)
        throw error
      }

      if (dto.matchStatus) {
        await tx.exchangeMatch.update({
          where: { id: dispute.matchId },
          data: {
            status: dto.matchStatus as never,
            closedAt:
              dto.matchStatus === ExchangeMatchStatus.ACTIVE ? null : now,
            closedByUserId:
              dto.matchStatus === ExchangeMatchStatus.ACTIVE ? null : adminUserId,
            closeReason:
              dto.matchStatus === ExchangeMatchStatus.ACTIVE
                ? null
                : dto.resolution?.trim() || 'dispute_resolution',
          },
        })

        await tx.exchangeProposal.update({
          where: { id: dispute.match.proposalId },
          data: {
            status:
              dto.matchStatus === ExchangeMatchStatus.ACTIVE ||
              dto.matchStatus === ExchangeMatchStatus.COMPLETED
                ? (ExchangeProposalStatus.ACCEPTED as never)
                : dto.matchStatus === ExchangeMatchStatus.EXPIRED
                  ? (ExchangeProposalStatus.EXPIRED as never)
                  : (ExchangeProposalStatus.CANCELLED as never),
          },
        })
      }
    })

    const updated = await this.getDisputeOrThrow(disputeId)

    await this.notifyParticipants(updated, {
      title: 'Tu disputa fue actualizada',
      body: `Estado: ${updated.status}. ${updated.resolution ?? ''}`.trim(),
      priority: shouldResolve ? 'CRITICAL' : 'HIGH',
      sourceEvent: 'catalog.dispute_updated',
    })

    return this.serializeDispute(updated)
  }

  private async getMatchForDisputeOrThrow(matchId: string) {
    const match = await this.prismaService.exchangeMatch.findUnique({
      where: { id: matchId },
      include: matchForDisputeInclude,
    })

    if (!match) {
      throw new NotFoundException('Exchange match not found')
    }

    return match
  }

  private async getDisputeOrThrow(disputeId: string) {
    let dispute: ExchangeDisputeWithRelations | null

    try {
      dispute = await this.prismaService.exchangeDispute.findUnique({
        where: { id: disputeId },
        include: disputeInclude,
      })
    } catch (error) {
      this.throwIfMissingDisputeTable(error)
      throw error
    }

    if (!dispute) {
      throw new NotFoundException('Exchange dispute not found')
    }

    return dispute
  }

  private assertMatchParticipant(userId: string, match: ExchangeMatchForDispute) {
    if (userId !== match.requesterUserId && userId !== match.targetUserId) {
      throw new ForbiddenException('Only exchange participants can open disputes')
    }
  }

  private assertDisputeParticipant(
    userId: string,
    dispute: Pick<ExchangeDisputeWithRelations, 'requesterUserId' | 'targetUserId'>,
  ) {
    if (userId !== dispute.requesterUserId && userId !== dispute.targetUserId) {
      throw new ForbiddenException('Only dispute participants can view this case')
    }
  }

  private assertDisputeCanReceiveMessages(
    dispute: Pick<ExchangeDisputeWithRelations, 'status'>,
  ) {
    if (
      dispute.status === ExchangeDisputeStatus.RESOLVED ||
      dispute.status === ExchangeDisputeStatus.CLOSED
    ) {
      throw new BadRequestException('Resolved disputes cannot receive messages')
    }
  }

  private async notifyParticipants(
    dispute: Pick<
      ExchangeDisputeWithRelations,
      'id' | 'matchId' | 'requesterUserId' | 'targetUserId' | 'title' | 'status'
    > & { resolution?: string | null },
    input: {
      title: string
      body: string
      priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'
      sourceEvent: string
      exceptUserId?: string
    },
  ) {
    const userIds = [dispute.requesterUserId, dispute.targetUserId].filter(
      (userId) => userId !== input.exceptUserId,
    )

    await this.notificationsApiService.publish({
      userIds,
      type: 'SYSTEM',
      title: input.title,
      body: input.body,
      data: {
        disputeId: dispute.id,
        matchId: dispute.matchId,
        status: dispute.status,
      },
      priority: input.priority,
      sourceEvent: input.sourceEvent,
    })
  }

  private serializeDisputeForUser(dispute: ExchangeDisputeWithRelations) {
    return this.serializeDispute(dispute, { hideInternalNotes: true })
  }

  private serializeDispute(
    dispute: ExchangeDisputeWithRelations,
    options: { hideInternalNotes?: boolean } = {},
  ) {
    const messages = options.hideInternalNotes
      ? dispute.messages.filter((message) => !message.isInternalNote)
      : dispute.messages

    return {
      id: dispute.id,
      matchId: dispute.matchId,
      proposalId: dispute.proposalId,
      openedByUserId: dispute.openedByUserId,
      requesterUserId: dispute.requesterUserId,
      targetUserId: dispute.targetUserId,
      status: dispute.status,
      reason: dispute.reason,
      title: dispute.title,
      description: dispute.description,
      resolution: dispute.resolution,
      assignedAdminUserId: dispute.assignedAdminUserId,
      resolvedByAdminUserId: dispute.resolvedByAdminUserId,
      resolvedAt: dispute.resolvedAt,
      closedAt: dispute.closedAt,
      createdAt: dispute.createdAt,
      updatedAt: dispute.updatedAt,
      requestedItem: this.serializeItem(dispute.requestedItem),
      offeredItem: this.serializeItem(dispute.offeredItem),
      match: {
        id: dispute.match.id,
        status: dispute.match.status,
        closeReason: dispute.match.closeReason,
        closedAt: dispute.match.closedAt,
        proposal: {
          id: dispute.match.proposal.id,
          status: dispute.match.proposal.status,
          message: dispute.match.proposal.message,
        },
      },
      messages: messages.map((message) => ({
        id: message.id,
        senderType: message.senderType,
        senderUserId: message.senderUserId,
        senderAdminUserId: message.senderAdminUserId,
        text: message.text,
        isInternalNote: message.isInternalNote,
        createdAt: message.createdAt,
      })),
    }
  }

  private async safeExchangeDisputeFindFirst(
    args: Prisma.ExchangeDisputeFindFirstArgs,
  ) {
    try {
      return await this.prismaService.exchangeDispute.findFirst(args)
    } catch (error) {
      if (this.isMissingDisputeTableError(error)) {
        return null
      }

      throw error
    }
  }

  private async safeExchangeDisputeFindMany(
    args: Prisma.ExchangeDisputeFindManyArgs,
  ): Promise<ExchangeDisputeWithRelations[]> {
    try {
      return (await this.prismaService.exchangeDispute.findMany(
        args,
      )) as ExchangeDisputeWithRelations[]
    } catch (error) {
      if (this.isMissingDisputeTableError(error)) {
        return []
      }

      throw error
    }
  }

  private throwIfMissingDisputeTable(error: unknown): never | void {
    if (this.isMissingDisputeTableError(error)) {
      throw new NotFoundException(
        'Exchange dispute feature is not available in this database yet',
      )
    }
  }

  private isMissingDisputeTableError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2021'
    )
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
