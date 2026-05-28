import { Injectable } from '@nestjs/common';
import {
  CatalogImageModerationStatus,
  CatalogItemPublicationStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { NotificationsApiService } from '../../common/notifications-api.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { QueueService } from '../../queue/queue.service';
import { CatalogImageModerationService } from './catalog-image-moderation.service';
import {
  CatalogTextModerationResult,
  CatalogTextModerationService,
} from './catalog-text-moderation.service';
import {
  CATALOG_IMAGE_MODERATION_JOB,
  CATALOG_TEXT_MODERATION_JOB,
} from './catalog-publication-moderation.constants';

type QueueContext = {
  attemptsMade: number;
  maxAttempts: number;
};

type PublicationModerationState = {
  version: string;
  textStatus: string;
  textFlags: string[];
  textRiskLevel: string | null;
  textRecommendedAction: string | null;
  textErrorMessage: string | null;
  pendingImages: number;
  approvedImages: number;
  reviewImages: number;
  blockedImages: number;
  errorImages: number;
};

type OwnerModerationReport = {
  state: 'UNDER_REVIEW' | 'BLOCKED';
  title: string;
  message: string;
  reasons: string[];
  details: {
    textStatus: string;
    blockedImages: number;
    reviewImages: number;
    errorImages: number;
  };
  updatedAt: string;
};

@Injectable()
export class CatalogPublicationModerationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly queueService: QueueService,
    private readonly storageService: StorageService,
    private readonly notificationsApiService: NotificationsApiService,
    private readonly catalogImageModerationService: CatalogImageModerationService,
    private readonly catalogTextModerationService: CatalogTextModerationService,
  ) {}

  async queuePublicationReview(itemId: string) {
    const item = await this.prismaService.catalogItem.findUnique({
      where: { id: itemId },
      include: {
        images: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!item || item.deletedAt) {
      return null;
    }

    const version = randomUUID();
    const text = this.buildModerationText(item);
    const client = await this.queueService.getSystemQueue().client;
    const stateKey = this.buildStateKey(itemId);
    const pendingReport = this.buildPendingOwnerModerationReport();

    await client.del(stateKey);
    await client.hset(stateKey, {
      version,
      textStatus: text ? 'QUEUED' : 'APPROVED',
      textFlags: '[]',
      textRiskLevel: '',
      textRecommendedAction: '',
      textErrorMessage: '',
      pendingImages: String(item.images.length),
      approvedImages: '0',
      reviewImages: '0',
      blockedImages: '0',
      errorImages: '0',
    });
    await client.expire(stateKey, 60 * 60 * 24);

    await this.prismaService.catalogItem.update({
      where: { id: item.id },
      data: {
        publicationStatus: CatalogItemPublicationStatus.UNDER_REVIEW,
        ownerModerationReport: pendingReport as Prisma.InputJsonValue,
      },
    });

    await this.notificationsApiService.publish({
      userId: item.ownerUserId,
      type: 'PUBLICATION_UNDER_REVIEW',
      title: 'Tu publicación está en revisión',
      body: 'Estamos validando el texto y las imágenes antes de mostrarla al resto de usuarios.',
      data: {
        itemId: item.id,
        publicationStatus: 'UNDER_REVIEW',
      },
      sourceEvent: 'catalog.publication_review_queued',
    });

    const queue = this.queueService.getSystemQueue();

    if (text) {
      await queue.add(
        CATALOG_TEXT_MODERATION_JOB,
        {
          itemId,
          userId: item.ownerUserId,
          text,
          version,
        },
        {
          jobId: `${CATALOG_TEXT_MODERATION_JOB}:${itemId}:${version}`,
        },
      );
    }

    for (const image of item.images) {
      if (!image.storagePath) {
        await this.markImageError(itemId, version);
        continue;
      }

      await queue.add(
        CATALOG_IMAGE_MODERATION_JOB,
        {
          itemId,
          imageId: image.id,
          storageKey: image.storagePath,
          version,
        },
        {
          jobId: `${CATALOG_IMAGE_MODERATION_JOB}:${image.id}:${version}`,
        },
      );
    }

    if (!text && item.images.length === 0) {
      await this.finalizePublicationReview(itemId, version);
    }

    return {
      queued: true,
      itemId,
      version,
    };
  }

  async processQueuedTextModeration(
    payload: {
      itemId: string;
      userId: string;
      text: string;
      version: string;
    },
    _jobContext: QueueContext,
  ) {
    const state = await this.getState(payload.itemId);

    if (!state || state.version !== payload.version) {
      return;
    }

    try {
      const result = await this.catalogTextModerationService.analyzeItem({
        itemId: payload.itemId,
        userId: payload.userId,
        text: payload.text,
      });

      await this.applyTextModerationResult(payload.itemId, result);
    } catch (error) {
      await this.setTextError(
        payload.itemId,
        error instanceof Error ? error.message : 'text_moderation_failed',
      );
    }

    await this.finalizePublicationReview(payload.itemId, payload.version);
  }

  async processQueuedImageModeration(
    payload: {
      itemId: string;
      imageId: string;
      storageKey: string;
      version: string;
    },
    _jobContext: QueueContext,
  ) {
    const state = await this.getState(payload.itemId);

    if (!state || state.version !== payload.version) {
      return;
    }

    try {
      const imageUrl =
        await this.storageService.createCatalogItemImageReadUrl(
          payload.storageKey,
        );

      const moderation =
        await this.catalogImageModerationService.analyzeCatalogItemImage({
          catalogItemId: payload.itemId,
          catalogItemImageId: payload.imageId,
          imageUrl,
        });

      await this.applyImageModerationResult(
        payload.itemId,
        moderation.status ?? CatalogImageModerationStatus.ERROR,
      );
    } catch (error) {
      await this.markImageError(payload.itemId, payload.version);
    }

    await this.finalizePublicationReview(payload.itemId, payload.version);
  }

  private async applyTextModerationResult(
    itemId: string,
    result: CatalogTextModerationResult,
  ) {
    const nextStatus =
      result.recommendedAction === 'APPROVE'
        ? 'APPROVED'
        : result.recommendedAction === 'REMOVE_PRODUCT'
          ? 'BLOCKED'
          : 'NEEDS_REVIEW';

    const client = await this.queueService.getSystemQueue().client;
    await client.hset(this.buildStateKey(itemId), {
      textStatus: nextStatus,
      textFlags: JSON.stringify(result.flags ?? []),
      textRiskLevel: result.riskLevel ?? '',
      textRecommendedAction: result.recommendedAction ?? '',
      textErrorMessage: '',
    });
  }

  private async applyImageModerationResult(
    itemId: string,
    status: CatalogImageModerationStatus,
  ) {
    const client = await this.queueService.getSystemQueue().client;
    const key = this.buildStateKey(itemId);

    await client.hincrby(key, 'pendingImages', -1);

    switch (status) {
      case CatalogImageModerationStatus.APPROVED:
        await client.hincrby(key, 'approvedImages', 1);
        break;
      case CatalogImageModerationStatus.BLOCKED:
        await client.hincrby(key, 'blockedImages', 1);
        break;
      case CatalogImageModerationStatus.NEEDS_REVIEW:
        await client.hincrby(key, 'reviewImages', 1);
        break;
      default:
        await client.hincrby(key, 'errorImages', 1);
        break;
    }
  }

  private async markImageError(itemId: string, version: string) {
    const state = await this.getState(itemId);

    if (!state || state.version !== version) {
      return;
    }

    const client = await this.queueService.getSystemQueue().client;
    const key = this.buildStateKey(itemId);
    await client.hincrby(key, 'pendingImages', -1);
    await client.hincrby(key, 'errorImages', 1);
  }

  private async setTextError(itemId: string, errorMessage: string) {
    const client = await this.queueService.getSystemQueue().client;
    await client.hset(this.buildStateKey(itemId), {
      textStatus: 'ERROR',
      textErrorMessage: errorMessage,
    });
  }

  private async finalizePublicationReview(itemId: string, version: string) {
    const state = await this.getState(itemId);

    if (!state || state.version !== version) {
      return;
    }

    const item = await this.prismaService.catalogItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        ownerUserId: true,
        title: true,
        publicationStatus: true,
        ownerModerationReport: true,
        publishedAt: true,
        deletedAt: true,
      },
    });

    if (!item || item.deletedAt) {
      return;
    }

    const nextStatus = this.resolveNextPublicationStatus(state);
    const ownerModerationReport =
      nextStatus === CatalogItemPublicationStatus.ACTIVE
        ? Prisma.JsonNull
        : ((await this.buildOwnerModerationReport(
            itemId,
            nextStatus,
            state,
          )) as Prisma.InputJsonValue);

    const updatedItem = await this.prismaService.catalogItem.update({
      where: { id: itemId },
      data: {
        publicationStatus: nextStatus,
        publishedAt:
          nextStatus === CatalogItemPublicationStatus.ACTIVE
            ? item.publishedAt ?? new Date()
            : item.publishedAt,
        ownerModerationReport,
      },
      select: {
        id: true,
        ownerUserId: true,
        title: true,
        publicationStatus: true,
        ownerModerationReport: true,
      },
    });

    await this.emitOwnerNotification(item, updatedItem, nextStatus);
  }

  private resolveNextPublicationStatus(state: PublicationModerationState) {
    if (state.blockedImages > 0 || state.textStatus === 'BLOCKED') {
      return CatalogItemPublicationStatus.BLOCKED;
    }

    if (state.pendingImages > 0 || state.textStatus === 'QUEUED') {
      return CatalogItemPublicationStatus.UNDER_REVIEW;
    }

    if (
      state.reviewImages > 0 ||
      state.errorImages > 0 ||
      state.textStatus === 'NEEDS_REVIEW' ||
      state.textStatus === 'ERROR'
    ) {
      return CatalogItemPublicationStatus.UNDER_REVIEW;
    }

    return CatalogItemPublicationStatus.ACTIVE;
  }

  private async emitOwnerNotification(
    previousItem: {
      id: string;
      ownerUserId: string;
      title: string;
      publicationStatus: CatalogItemPublicationStatus;
    },
    updatedItem: {
      id: string;
      ownerUserId: string;
      title: string;
      publicationStatus: CatalogItemPublicationStatus;
      ownerModerationReport: Prisma.JsonValue | null;
    },
    nextStatus: CatalogItemPublicationStatus,
  ) {
    if (previousItem.publicationStatus === nextStatus) {
      return;
    }

    if (nextStatus === CatalogItemPublicationStatus.ACTIVE) {
      await this.notificationsApiService.publish({
        userId: updatedItem.ownerUserId,
        type: 'PUBLICATION_APPROVED',
        title: 'Tu publicación ya está activa',
        body: `"${updatedItem.title}" ya se está mostrando en el catálogo público.`,
        data: {
          itemId: updatedItem.id,
          publicationStatus: nextStatus,
        },
        sourceEvent: 'catalog.publication_approved',
      });
      return;
    }

    if (nextStatus === CatalogItemPublicationStatus.BLOCKED) {
      const report = this.parseOwnerModerationReport(
        updatedItem.ownerModerationReport,
      );
      await this.notificationsApiService.publish({
        userId: updatedItem.ownerUserId,
        type: 'PUBLICATION_BLOCKED',
        title: 'Bloqueamos tu publicación',
        body:
          report?.message ||
          `"${updatedItem.title}" fue bloqueada por nuestras políticas.`,
        subtitle: report?.reasons?.[0],
        data: {
          itemId: updatedItem.id,
          publicationStatus: nextStatus,
          ownerModerationReport: report,
        },
        priority: 'HIGH',
        sourceEvent: 'catalog.publication_blocked',
      });
      return;
    }

    if (nextStatus === CatalogItemPublicationStatus.UNDER_REVIEW) {
      const report = this.parseOwnerModerationReport(
        updatedItem.ownerModerationReport,
      );
      await this.notificationsApiService.publish({
        userId: updatedItem.ownerUserId,
        type: 'PUBLICATION_UPDATE',
        title: 'Tu publicación sigue en revisión',
        body:
          report?.message ||
          `"${updatedItem.title}" sigue pendiente de revisión manual.`,
        subtitle: report?.reasons?.[0],
        data: {
          itemId: updatedItem.id,
          publicationStatus: nextStatus,
          ownerModerationReport: report,
        },
        sourceEvent: 'catalog.publication_manual_review',
      });
    }
  }

  private async buildOwnerModerationReport(
    itemId: string,
    status: CatalogItemPublicationStatus,
    state: PublicationModerationState,
  ): Promise<OwnerModerationReport> {
    const latestImageModerations =
      await this.prismaService.catalogItemImageModeration.findMany({
        where: {
          catalogItemId: itemId,
          status: {
            in: [
              CatalogImageModerationStatus.BLOCKED,
              CatalogImageModerationStatus.NEEDS_REVIEW,
              CatalogImageModerationStatus.ERROR,
            ],
          },
        },
        orderBy: [{ analyzedAt: 'desc' }, { createdAt: 'desc' }],
        take: 6,
      });

    const reasons = Array.from(
      new Set([
        ...state.textFlags.map((flag) => this.formatModerationFlag(flag)),
        ...latestImageModerations.flatMap((moderation) =>
          moderation.flags.map((flag) => this.formatModerationFlag(flag)),
        ),
        ...(state.textErrorMessage
          ? ['No pudimos validar automáticamente el texto de la publicación.']
          : []),
        ...(state.errorImages > 0
          ? ['No pudimos validar automáticamente una o más imágenes.']
          : []),
      ].filter(Boolean)),
    );

    if (!reasons.length) {
      reasons.push(
        status === CatalogItemPublicationStatus.BLOCKED
          ? 'Detectamos señales que incumplen nuestras políticas de publicación.'
          : 'Detectamos señales que requieren revisión manual antes de publicarla.',
      );
    }

    return {
      state:
        status === CatalogItemPublicationStatus.BLOCKED
          ? 'BLOCKED'
          : 'UNDER_REVIEW',
      title:
        status === CatalogItemPublicationStatus.BLOCKED
          ? 'Publicación bloqueada'
          : 'Publicación en revisión',
      message:
        status === CatalogItemPublicationStatus.BLOCKED
          ? 'Bloqueamos esta publicación porque encontramos contenido que no cumple nuestras políticas.'
          : 'Tu publicación quedó en revisión manual mientras terminamos de validar el contenido.',
      reasons,
      details: {
        textStatus: state.textStatus,
        blockedImages: state.blockedImages,
        reviewImages: state.reviewImages,
        errorImages: state.errorImages,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  private buildPendingOwnerModerationReport(): OwnerModerationReport {
    return {
      state: 'UNDER_REVIEW',
      title: 'Publicación en revisión',
      message:
        'Estamos validando el texto y las imágenes antes de mostrar tu publicación al resto de usuarios.',
      reasons: ['Validación automática de texto e imágenes en curso.'],
      details: {
        textStatus: 'QUEUED',
        blockedImages: 0,
        reviewImages: 0,
        errorImages: 0,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  private parseOwnerModerationReport(value: Prisma.JsonValue | null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as unknown as OwnerModerationReport;
  }

  private async getState(
    itemId: string,
  ): Promise<PublicationModerationState | null> {
    const client = await this.queueService.getSystemQueue().client;
    const raw = await client.hgetall(this.buildStateKey(itemId));

    if (!raw.version) {
      return null;
    }

    return {
      version: raw.version,
      textStatus: raw.textStatus ?? 'QUEUED',
      textFlags: this.parseStringArray(raw.textFlags),
      textRiskLevel: raw.textRiskLevel || null,
      textRecommendedAction: raw.textRecommendedAction || null,
      textErrorMessage: raw.textErrorMessage || null,
      pendingImages: Number(raw.pendingImages ?? 0),
      approvedImages: Number(raw.approvedImages ?? 0),
      reviewImages: Number(raw.reviewImages ?? 0),
      blockedImages: Number(raw.blockedImages ?? 0),
      errorImages: Number(raw.errorImages ?? 0),
    };
  }

  private parseStringArray(value?: string) {
    if (!value) {
      return [];
    }

    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === 'string')
        : [];
    } catch {
      return [];
    }
  }

  private formatModerationFlag(flag: string) {
    const normalized = flag.trim().toUpperCase();

    switch (normalized) {
      case 'IMAGE_DOWNLOAD_FAILED':
        return 'No pudimos descargar una imagen para validarla.';
      case 'EXTERNAL_CONTACT':
      case 'CONTACT_INFO':
        return 'Detectamos datos de contacto directos dentro de la publicación.';
      case 'SEXUAL_CONTENT':
        return 'Detectamos contenido sexual o no permitido.';
      case 'VIOLENCE':
        return 'Detectamos contenido violento o sensible.';
      case 'WEAPON':
      case 'WEAPONS':
        return 'Detectamos referencias a armas o elementos prohibidos.';
      case 'SCAM':
      case 'FRAUD':
        return 'Detectamos señales asociadas a fraude o engaño.';
      case 'OFF_PLATFORM':
      case 'EXTERNAL_LINK':
        return 'Detectamos intentos de mover la conversación fuera de Truo.';
      case 'PROHIBITED_PRODUCT':
        return 'Detectamos un producto o contenido prohibido.';
      default:
        return `Motivo detectado: ${normalized.replaceAll('_', ' ').toLowerCase()}.`;
    }
  }

  private buildModerationText(item: {
    title: string;
    description: string;
    exchangePreferences: string | null;
  }) {
    return [item.title, item.description, item.exchangePreferences ?? '']
      .map((value) => value.trim())
      .filter(Boolean)
      .join('\n\n');
  }

  private buildStateKey(itemId: string) {
    return `catalog-publication-review:${itemId}`;
  }
}
