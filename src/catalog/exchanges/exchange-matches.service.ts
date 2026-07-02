import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { NotificationsApiService } from '../../common/notifications-api.service'
import { sanitizePlainText } from '../../common/utils/sanitize-text.util'
import { CatalogItemsService } from '../items/catalog-items.service'
import { ChatApiService } from './chat-api.service'
import {
  CatalogItemPublicationStatus,
  ExchangeMatchStatus,
  ExchangeProposalStatus,
} from '../shared/catalog.constants'
import { CloseExchangeMatchDto } from '../dto/close-exchange-match.dto'
import { SubmitExchangeMatchFeedbackDto } from '../dto/submit-exchange-match-feedback.dto'
import { CatalogActor } from '../interfaces/catalog-actor.interface'

const matchDetailInclude = {
  proposal: true,
  feedbacks: true,
  completionConfirmations: true,
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

const FEEDBACK_REMINDER_START_DELAY_MS = 4 * 60 * 60 * 1000
const FEEDBACK_REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000
const FEEDBACK_REMINDER_MAX_COUNT = 14

@Injectable()
export class ExchangeMatchesService implements OnModuleInit, OnModuleDestroy {
  private feedbackReminderTimer?: NodeJS.Timeout

  constructor(
    private readonly prismaService: PrismaService,
    private readonly itemsService: CatalogItemsService,
    private readonly notificationsApiService: NotificationsApiService,
    private readonly chatApiService: ChatApiService
  ) {}

  onModuleInit() {
    this.feedbackReminderTimer = setInterval(
      () =>
        void this.sendPendingFeedbackReminders().catch(() => {
          // Best-effort reminder sweep; notification failures are logged by the publisher.
        }),
      6 * 60 * 60 * 1000
    )
    this.feedbackReminderTimer.unref?.()
  }

  onModuleDestroy() {
    if (this.feedbackReminderTimer) {
      clearInterval(this.feedbackReminderTimer)
    }
  }

  async listMyMatches(actor: CatalogActor) {
    const matches = await this.prismaService.exchangeMatch.findMany({
      where: {
        OR: [{ requesterUserId: actor.userId }, { targetUserId: actor.userId }],
      },
      include: matchDetailInclude,
      orderBy: [{ updatedAt: 'desc' }],
      take: 50,
    })

    return Promise.all(matches.map(match => this.serializeMatch(match, actor.userId)))
  }

  async getMatch(actor: CatalogActor, matchId: string) {
    const match = await this.getMatchOrThrow(matchId)
    this.assertMatchParticipant(actor, match)

    return this.serializeMatch(match, actor.userId)
  }

  async ensureChatForMatch(actor: CatalogActor, matchId: string) {
    const match = await this.getMatchOrThrow(matchId)
    this.assertMatchParticipant(actor, match)

    return this.chatApiService.ensureChatForMatch({
      matchId: match.id,
      proposalId: match.proposalId,
      requesterUserId: match.requesterUserId,
      targetUserId: match.targetUserId,
      requestedItemId: match.requestedItemId,
      offeredItemId: match.offeredItemId,
      requestedItemSnapshot: this.serializeChatItemSnapshot(
        match.requestedItem
      ) as Record<string, unknown>,
      offeredItemSnapshot: this.serializeChatItemSnapshot(
        match.offeredItem
      ) as Record<string, unknown>,
    })
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
    const negotiatedItemIds = this.resolveNegotiatedItemIds(match)

    const result = await this.prismaService.$transaction(async tx => {
      await tx.exchangeMatchParticipantConfirmation.upsert({
        where: {
          matchId_userId: {
            matchId: match.id,
            userId: actor.userId,
          },
        },
        update: {
          confirmedAt: now,
        },
        create: {
          matchId: match.id,
          userId: actor.userId,
          confirmedAt: now,
        },
      })

      const participantConfirmations =
        await tx.exchangeMatchParticipantConfirmation.findMany({
          where: {
            matchId: match.id,
            userId: {
              in: [match.requesterUserId, match.targetUserId],
            },
          },
        })

      if (participantConfirmations.length < 2) {
        const pendingMatch = await tx.exchangeMatch.findUniqueOrThrow({
          where: {
            id: match.id,
          },
          include: matchDetailInclude,
        })

        return {
          updatedMatch: pendingMatch,
          affectedItemIds: [] as string[],
          completed: false,
        }
      }

      const pendingProposalsToExpire = await tx.exchangeProposal.findMany({
        where: {
          status: ExchangeProposalStatus.PENDING as never,
          id: {
            not: match.proposalId,
          },
          OR: negotiatedItemIds.flatMap(itemId => [
            { requestedItemId: itemId },
            { offeredItemId: itemId },
          ]),
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
          OR: negotiatedItemIds.flatMap(itemId => [
            { requestedItemId: itemId },
            { offeredItemId: itemId },
          ]),
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
            in: negotiatedItemIds,
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
        updatedMatch: await tx.exchangeMatch.findUniqueOrThrow({
          where: {
            id: updatedMatch.id,
          },
          include: matchDetailInclude,
        }),
        affectedItemIds: [
          ...negotiatedItemIds,
          ...pendingProposalsToExpire.flatMap(proposal => [
            proposal.requestedItemId,
            proposal.offeredItemId,
          ]),
          ...activeMatchesToCancel.flatMap(activeMatch => [
            activeMatch.requestedItemId,
            activeMatch.offeredItemId,
          ]),
        ],
        completed: true,
      }
    })

    if (!result.completed) {
      return this.serializeMatch(result.updatedMatch, actor.userId)
    }

    const affectedItemIds = Array.from(new Set(result.affectedItemIds))

    await Promise.all(
      affectedItemIds.map(itemId =>
        this.itemsService.syncNegotiationStatus(itemId)
      )
    )

    this.onMatchLifecycleEvent('match_completed', result.updatedMatch)
    await this.publishInitialFeedbackReminder(result.updatedMatch)
    return this.serializeMatch(result.updatedMatch, actor.userId)
  }

  async submitMatchFeedback(
    actor: CatalogActor,
    matchId: string,
    dto: SubmitExchangeMatchFeedbackDto
  ) {
    const match = await this.getMatchOrThrow(matchId)
    this.assertMatchParticipant(actor, match)

    if (match.status !== ExchangeMatchStatus.COMPLETED) {
      throw new BadRequestException(
        'Only completed Truos can receive feedback'
      )
    }

    const reviewedUserId =
      actor.userId === match.requesterUserId
        ? match.targetUserId
        : match.requesterUserId
    const comment = sanitizePlainText(dto.comment, {
      preserveNewLines: true,
    }).trim()

    await this.prismaService.exchangeMatchFeedback.upsert({
      where: {
        matchId_reviewerUserId: {
          matchId: match.id,
          reviewerUserId: actor.userId,
        },
      },
      update: {
        reviewedUserId,
        wasEffectiveInPerson: dto.wasEffectiveInPerson,
        rating: dto.rating,
        comment: comment || null,
      },
      create: {
        matchId: match.id,
        reviewerUserId: actor.userId,
        reviewedUserId,
        wasEffectiveInPerson: dto.wasEffectiveInPerson,
        rating: dto.rating,
        comment: comment || null,
      },
    })

    await this.itemsService.invalidateOwnerRankingCaches(reviewedUserId)

    const refreshedMatch = await this.getMatchOrThrow(match.id)
    return this.serializeMatch(refreshedMatch, actor.userId)
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
    return this.serializeMatch(refreshedMatch, actor.userId)
  }

  private onMatchLifecycleEvent(
    _event: 'match_completed' | 'match_closed',
    _match: ExchangeMatchWithRelations
  ) {
    // Hook reserved for Fase 3+: chat, reputacion y notificaciones basadas en eventos de match.
  }

  private async publishInitialFeedbackReminder(match: ExchangeMatchWithRelations) {
    await this.notificationsApiService.publish({
      userIds: [match.requesterUserId, match.targetUserId],
      type: 'SYSTEM',
      title: 'Post-Truo pendiente',
      body: 'Cuando hagan el intercambio en físico, cuéntanos si se concretó y califica a la otra persona.',
      data: {
        matchId: match.id,
        proposalId: match.proposalId,
        requestedItemId: match.requestedItemId,
        offeredItemId: match.offeredItemId,
      },
      priority: 'NORMAL',
      sourceEvent: 'catalog.truo_feedback_initial_reminder',
    })
  }

  private async sendPendingFeedbackReminders() {
    const now = new Date()
    const oldestCompletionForReminder = new Date(
      now.getTime() - FEEDBACK_REMINDER_START_DELAY_MS
    )
    const reminderCutoff = new Date(
      now.getTime() - FEEDBACK_REMINDER_INTERVAL_MS
    )

    const matches = await this.prismaService.exchangeMatch.findMany({
      where: {
        status: ExchangeMatchStatus.COMPLETED as never,
        completedAt: {
          lte: oldestCompletionForReminder,
        },
      },
      select: {
        id: true,
        proposalId: true,
        requesterUserId: true,
        targetUserId: true,
        requestedItemId: true,
        offeredItemId: true,
        requestedItem: { select: { title: true } },
        offeredItem: { select: { title: true } },
        feedbacks: {
          select: {
            reviewerUserId: true,
          },
        },
        feedbackReminders: {
          select: {
            userId: true,
            reminderCount: true,
            lastSentAt: true,
          },
        },
      },
      orderBy: [{ completedAt: 'asc' }],
      take: 100,
    })

    for (const match of matches) {
      const reviewedUserIds = new Set(
        match.feedbacks.map(feedback => feedback.reviewerUserId)
      )

      for (const userId of [match.requesterUserId, match.targetUserId]) {
        if (reviewedUserIds.has(userId)) {
          continue
        }

        const reminder = match.feedbackReminders.find(
          current => current.userId === userId
        )
        const shouldSend =
          !reminder ||
          ((!reminder.lastSentAt || reminder.lastSentAt <= reminderCutoff) &&
            reminder.reminderCount < FEEDBACK_REMINDER_MAX_COUNT)

        if (!shouldSend) {
          continue
        }

        await this.notificationsApiService.publish({
          userId,
          type: 'SYSTEM',
          title: '¿Ya se hizo el Truo en físico?',
          body: `Cuéntanos si el intercambio "${match.requestedItem.title}" x "${match.offeredItem.title}" se concretó y califica a la otra persona.`,
          data: {
            matchId: match.id,
            proposalId: match.proposalId,
            requestedItemId: match.requestedItemId,
            offeredItemId: match.offeredItemId,
          },
          priority: 'NORMAL',
          sourceEvent: 'catalog.truo_feedback_recurring_reminder',
        })

        await this.prismaService.exchangeMatchFeedbackReminder.upsert({
          where: {
            matchId_userId: {
              matchId: match.id,
              userId,
            },
          },
          update: {
            lastSentAt: now,
            reminderCount: {
              increment: 1,
            },
          },
          create: {
            matchId: match.id,
            userId,
            lastSentAt: now,
            reminderCount: 1,
          },
        })
      }
    }
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

  private serializeChatItemSnapshot(
    item: ExchangeMatchWithRelations['requestedItem']
  ) {
    return {
      id: item.id,
      ownerUserId: item.ownerUserId,
      title: item.title,
      slug: item.slug,
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
      })),
    }
  }

  private resolveNegotiatedItemIds(match: ExchangeMatchWithRelations) {
    const extraItemIds = this.extractProposalItemReferences(match.proposal.message)
      .filter(reference => reference.itemType === 'extra')
      .map(reference => reference.itemId)

    return Array.from(
      new Set([match.requestedItemId, match.offeredItemId, ...extraItemIds])
    )
  }

  private extractProposalItemReferences(message?: string | null) {
    if (!message) {
      return []
    }

    return [...message.matchAll(/\[\[ITEM:([^\]]+)\]\]/gi)]
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
  }

  private async serializeMatch(
    match: ExchangeMatchWithRelations,
    currentUserId?: string
  ) {
    const feedbacks = match.feedbacks.map(feedback => ({
      id: feedback.id,
      matchId: feedback.matchId,
      reviewerUserId: feedback.reviewerUserId,
      reviewedUserId: feedback.reviewedUserId,
      wasEffectiveInPerson: feedback.wasEffectiveInPerson,
      rating: feedback.rating,
      comment: feedback.comment,
      createdAt: feedback.createdAt,
      updatedAt: feedback.updatedAt,
      isOwn: feedback.reviewerUserId === currentUserId,
    }))
    const selfFeedback =
      feedbacks.find(feedback => feedback.reviewerUserId === currentUserId) ??
      null
    const peerFeedback =
      feedbacks.find(feedback => feedback.reviewerUserId !== currentUserId) ??
      null
    const selfConfirmation =
      match.completionConfirmations.find(
        confirmation => confirmation.userId === currentUserId
      ) ?? null
    const peerConfirmation =
      match.completionConfirmations.find(
        confirmation => confirmation.userId !== currentUserId
      ) ?? null
    const bothParticipantsConfirmed = Boolean(
      selfConfirmation?.confirmedAt && peerConfirmation?.confirmedAt
    )
    const bothParticipantsReviewed = feedbacks.length >= 2
    const bothConfirmedEffective =
      bothParticipantsReviewed &&
      feedbacks.every(feedback => feedback.wasEffectiveInPerson)
    const averageRating =
      feedbacks.length > 0
        ? feedbacks.reduce((sum, feedback) => sum + feedback.rating, 0) /
          feedbacks.length
        : null
    const feedbackPendingForCurrentUser =
      match.status === ExchangeMatchStatus.COMPLETED && !selfFeedback

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
      feedbacks,
      feedbackSummary: {
        selfFeedback,
        peerFeedback,
        bothParticipantsReviewed,
        bothConfirmedEffective,
        feedbackPendingForCurrentUser,
        averageRating,
      },
      completionSummary: {
        selfConfirmed: Boolean(selfConfirmation?.confirmedAt),
        selfConfirmedAt: selfConfirmation?.confirmedAt ?? null,
        peerConfirmed: Boolean(peerConfirmation?.confirmedAt),
        peerConfirmedAt: peerConfirmation?.confirmedAt ?? null,
        bothParticipantsConfirmed,
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
