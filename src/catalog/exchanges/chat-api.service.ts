import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class ChatApiService {
  private readonly logger = new Logger(ChatApiService.name)

  constructor(private readonly configService: ConfigService) {}

  async ensureChatForMatch(input: {
    matchId: string
    proposalId?: string | null
    requesterUserId: string
    targetUserId: string
    requestedItemId?: string | null
    offeredItemId?: string | null
    requestedItemSnapshot?: Record<string, unknown> | null
    offeredItemSnapshot?: Record<string, unknown> | null
  }) {
    const baseUrl = this.configService.get<string | undefined>('chatApi.baseUrl')

    if (!baseUrl) {
      this.logger.warn(
        `Chat API base URL is not configured. Skipping chat bootstrap for match ${input.matchId}`
      )
      return null
    }

    const timeoutMs = this.configService.get<number | undefined>('chatApi.timeoutMs') ?? 5000
    const internalToken =
      this.configService.get<string | undefined>('chatApi.internalToken')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(
        `${baseUrl.replace(/\/+$/, '')}/api/internal/chat/matches/${input.matchId}/open`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(internalToken ? { 'x-internal-token': internalToken } : {}),
          },
          body: JSON.stringify({
            proposalId: input.proposalId ?? null,
            requesterUserId: input.requesterUserId,
            targetUserId: input.targetUserId,
            requestedItemId: input.requestedItemId ?? null,
            offeredItemId: input.offeredItemId ?? null,
            requestedItemSnapshot: input.requestedItemSnapshot ?? null,
            offeredItemSnapshot: input.offeredItemSnapshot ?? null,
          }),
          signal: controller.signal,
        }
      )

      if (!response.ok) {
        throw new ServiceUnavailableException(
          `Chat API failed with status ${response.status}`
        )
      }

      return response.json()
    } finally {
      clearTimeout(timeout)
    }
  }
}
