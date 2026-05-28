import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type PublishNotificationInput = {
  broadcast?: boolean;
  userId?: string;
  userIds?: string[];
  type:
    | 'PUBLICATION_UNDER_REVIEW'
    | 'PUBLICATION_APPROVED'
    | 'PUBLICATION_BLOCKED'
    | 'PUBLICATION_UPDATE'
    | 'NEW_FOLLOWER'
    | 'NEW_MESSAGE'
    | 'NEW_MATCH'
    | 'PROMOTION'
    | 'SYSTEM';
  title: string;
  body: string;
  subtitle?: string;
  data?: Record<string, unknown>;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  sendPush?: boolean;
  sourceEvent?: string;
};

@Injectable()
export class NotificationsApiService {
  private readonly logger = new Logger(NotificationsApiService.name);

  constructor(private readonly configService: ConfigService) {}

  async publish(input: PublishNotificationInput) {
    const baseUrl =
      this.configService.get<string>('notifications.baseUrl')?.trim() || '';
    const internalToken =
      this.configService
        .get<string>('notifications.internalToken')
        ?.trim() || '';

    if (!baseUrl || !internalToken) {
      return;
    }

    const timeoutMs =
      this.configService.get<number>('notifications.timeoutMs') ?? 5000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(
        `${baseUrl.replace(/\/+$/, '')}/internal/notifications/publish`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-token': internalToken,
          },
          body: JSON.stringify({
            ...input,
            sourceService: 'catalog-api',
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        this.logger.warn(
          `Notifications API returned status ${response.status} for event ${input.sourceEvent ?? input.type}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to publish notification event ${input.sourceEvent ?? input.type}: ${
          error instanceof Error ? error.message : 'unknown_error'
        }`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
