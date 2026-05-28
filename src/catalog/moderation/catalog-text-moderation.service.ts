import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type CatalogTextModerationFinding = {
  type: string;
  flag: string;
  confidence: number;
  start?: number;
  end?: number;
  value?: string;
  redactedValue?: string;
  evidence?: string;
};

export type CatalogTextModerationResult = {
  jobId: string;
  entityId: string | null;
  userId: string | null;
  isProhibited: boolean;
  riskLevel: string;
  confidence: number;
  flags: string[];
  findings: CatalogTextModerationFinding[];
  recommendedAction: 'APPROVE' | 'SEND_TO_REVIEW' | 'REMOVE_PRODUCT' | string;
};

@Injectable()
export class CatalogTextModerationService {
  constructor(private readonly configService: ConfigService) {}

  async analyzeItem(input: {
    itemId: string;
    userId: string;
    text: string;
  }): Promise<CatalogTextModerationResult> {
    const workerUrl = this.configService.get<string>('moderation.textAnalyzerUrl');

    if (!workerUrl) {
      throw new ServiceUnavailableException(
        'Text analyzer worker is not configured',
      );
    }

    const timeoutMs =
      this.configService.get<number>('moderation.textAnalyzerTimeoutMs') ??
      12000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(
        `${workerUrl.replace(/\/+$/, '')}/analyze/text`,
        {
          method: 'POST',
          headers: this.buildWorkerHeaders(),
          body: JSON.stringify({
            jobId: `catalog-text-${input.itemId}`,
            sourceService: 'catalog-api',
            entityType: 'PRODUCT',
            entityId: input.itemId,
            userId: input.userId,
            fieldName: 'publication',
            text: input.text,
            locale: 'es-CO',
            context: {
              action: 'PUBLISH_CATALOG_ITEM',
              visibility: 'PUBLIC',
            },
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new ServiceUnavailableException(
          `Text analyzer failed with status ${response.status}`,
        );
      }

      return (await response.json()) as CatalogTextModerationResult;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildWorkerHeaders() {
    const internalToken = this.configService.get<string>(
      'moderation.internalToken',
    );

    if (!internalToken) {
      throw new ServiceUnavailableException(
        'Moderation internal token is not configured',
      );
    }

    return {
      'Content-Type': 'application/json',
      'X-Internal-Token': internalToken,
    };
  }
}
