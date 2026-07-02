import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { CatalogCacheEventDto } from '../dto/catalog-cache-event.dto'
import { CatalogInternalTokenGuard } from '../guards/catalog-internal-token.guard'
import { CatalogOutboxService } from '../outbox/catalog-outbox.service'

@Controller('catalog/internal/cache-events')
@UseGuards(CatalogInternalTokenGuard)
export class CatalogInternalCacheEventsController {
  constructor(private readonly catalogOutboxService: CatalogOutboxService) {}

  @Post()
  async ingestCacheEvent(@Body() dto: CatalogCacheEventDto) {
    switch (dto.eventType) {
      case 'product.created':
      case 'product.updated':
      case 'product.deleted':
        if (dto.itemId) {
          await this.catalogOutboxService.emitItemChanged({
            itemId: dto.itemId,
            ownerUserId: dto.ownerUserId ?? null,
          })
        }
        break
      case 'avatar.updated':
      case 'premium.updated':
        if (dto.ownerUserId) {
          await this.catalogOutboxService.emitOwnerProfileChanged({
            ownerUserId: dto.ownerUserId,
            reason: dto.eventType,
          })
        }
        break
      case 'follow.created':
      case 'follow.deleted':
        if (dto.viewerUserId) {
          await this.catalogOutboxService.emitViewerRelationshipChanged({
            viewerUserId: dto.viewerUserId,
            ownerUserId: dto.ownerUserId ?? null,
            reason: dto.eventType,
          })
        }
        break
      case 'block.created':
      case 'block.deleted':
      case 'restriction.created':
      case 'restriction.updated':
        if (dto.viewerUserId) {
          await this.catalogOutboxService.emitViewerRelationshipChanged({
            viewerUserId: dto.viewerUserId,
            ownerUserId: dto.ownerUserId ?? null,
            reason: dto.eventType,
            securitySensitive: true,
          })
        } else if (dto.ownerUserId) {
          await this.catalogOutboxService.emitOwnerProfileChanged({
            ownerUserId: dto.ownerUserId,
            reason: dto.eventType,
          })
        }
        break
      case 'rating.updated':
        if (dto.ownerUserId) {
          await this.catalogOutboxService.emitOwnerRatingChanged(dto.ownerUserId)
        }
        break
      case 'story.created':
      case 'story.expired':
        await this.catalogOutboxService.emitStoryChanged({
          ownerUserId: dto.ownerUserId ?? null,
          viewerUserId: dto.viewerUserId ?? null,
          reason: dto.eventType,
        })
        break
      case 'negotiation.updated':
        await this.catalogOutboxService.emitProposalChanged({
          itemIds: dto.itemIds ?? (dto.itemId ? [dto.itemId] : []),
        })
        break
      case 'media.updated':
        if (dto.storagePath) {
          await this.catalogOutboxService.emitMediaChanged({
            storagePath: dto.storagePath,
            reason: dto.eventType,
          })
        }
        break
    }

    return {
      accepted: true,
      eventType: dto.eventType,
    }
  }
}
