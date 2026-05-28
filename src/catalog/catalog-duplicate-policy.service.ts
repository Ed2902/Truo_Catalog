import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogActor } from './interfaces/catalog-actor.interface';
import {
  buildTitleTokenSignature,
  normalizeCatalogText,
} from './utils/catalog-normalization.util';

interface DuplicateCandidateInput {
  title: string;
  description: string;
  categoryId: string;
  condition: string;
  images?: Array<{
    storagePath?: string;
    storageUrl: string;
  }>;
}

@Injectable()
export class CatalogDuplicatePolicyService {
  constructor(private readonly prismaService: PrismaService) {}

  async assertNoDuplicateFreeItem(
    actor: CatalogActor,
    candidate: DuplicateCandidateInput,
    excludeItemId?: string,
  ) {
    if (actor.isPremium) {
      return;
    }

    const normalizedTitle = normalizeCatalogText(candidate.title);
    const titleTokenSignature = buildTitleTokenSignature(candidate.title);
    const normalizedDescription = normalizeCatalogText(candidate.description);
    const incomingImageKeys = new Set(
      (candidate.images ?? [])
        .flatMap((image) => [image.storagePath, image.storageUrl])
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => value.trim()),
    );

    const existingItems = await this.prismaService.catalogItem.findMany({
      where: {
        ownerUserId: actor.userId,
        categoryId: candidate.categoryId,
        condition: candidate.condition as never,
        deletedAt: null,
        ...(excludeItemId
          ? {
              id: {
                not: excludeItemId,
              },
            }
          : {}),
      },
      select: {
        id: true,
        normalizedTitle: true,
        titleTokenSignature: true,
        normalizedDescription: true,
        images: {
          select: {
            storagePath: true,
            storageUrl: true,
          },
        },
      },
      take: 25,
    });

    const duplicate = existingItems.find((item) => {
      const hasSameTitle =
        item.normalizedTitle === normalizedTitle ||
        item.titleTokenSignature === titleTokenSignature;
      return hasSameTitle;
    });

    if (!duplicate) {
      return;
    }

    throw new ConflictException(
      `Duplicate item detected for free user. Existing item id: ${duplicate.id}`,
    );
  }
}
