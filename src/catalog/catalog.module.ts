import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { CommonModule } from '../common/common.module'
import { QueueModule } from '../queue/queue.module'
import { StorageModule } from '../storage/storage.module'
import { CatalogAdminController } from './admin/catalog-admin.controller'
import { CatalogAdminExchangesService } from './admin/catalog-admin-exchanges.service'
import { CatalogAdminMetricsService } from './admin/catalog-admin-metrics.service'
import { CatalogAdminQueueService } from './admin/catalog-admin-queue.service'
import { CatalogCategoriesController } from './categories/catalog-categories.controller'
import { CatalogCategoriesService } from './categories/catalog-categories.service'
import { CatalogNegotiationPolicyService } from './exchanges/catalog-negotiation-policy.service'
import { ChatApiService } from './exchanges/chat-api.service'
import { ExchangeDisputesController } from './exchanges/exchange-disputes.controller'
import { ExchangeDisputesService } from './exchanges/exchange-disputes.service'
import { ExchangeMatchesController } from './exchanges/exchange-matches.controller'
import { ExchangeMatchesService } from './exchanges/exchange-matches.service'
import { ExchangeProposalsController } from './exchanges/exchange-proposals.controller'
import { ExchangeProposalsService } from './exchanges/exchange-proposals.service'
import { IdentitySignalsService } from './identity/identity-signals.service'
import { CatalogHomeController } from './home/catalog-home.controller'
import { CatalogHomeService } from './home/catalog-home.service'
import { CatalogInternalCacheEventsController } from './internal/catalog-internal-cache-events.controller'
import { CatalogDuplicatePolicyService } from './items/catalog-duplicate-policy.service'
import { CatalogItemImagesController } from './items/catalog-item-images.controller'
import { CatalogItemImagesService } from './items/catalog-item-images.service'
import { CatalogItemsController } from './items/catalog-items.controller'
import { CatalogItemsService } from './items/catalog-items.service'
import { CatalogImageModerationService } from './moderation/catalog-image-moderation.service'
import { CatalogModerationController } from './moderation/catalog-moderation.controller'
import { CatalogPublicationModerationProcessor } from './moderation/catalog-publication-moderation.processor'
import { CatalogPublicationModerationService } from './moderation/catalog-publication-moderation.service'
import { CatalogTextModerationService } from './moderation/catalog-text-moderation.service'
import { CatalogOutboxProcessor } from './outbox/catalog-outbox.processor'
import { CatalogOutboxService } from './outbox/catalog-outbox.service'

@Module({
  imports: [AuthModule, CommonModule, StorageModule, QueueModule],
  controllers: [
    CatalogAdminController,
    CatalogCategoriesController,
    CatalogHomeController,
    CatalogInternalCacheEventsController,
    CatalogItemImagesController,
    CatalogModerationController,
    CatalogItemsController,
    ExchangeDisputesController,
    ExchangeProposalsController,
    ExchangeMatchesController,
  ],
  providers: [
    CatalogCategoriesService,
    CatalogImageModerationService,
    CatalogTextModerationService,
    CatalogPublicationModerationService,
    CatalogPublicationModerationProcessor,
    CatalogOutboxService,
    CatalogOutboxProcessor,
    CatalogAdminExchangesService,
    CatalogAdminQueueService,
    CatalogAdminMetricsService,
    CatalogHomeService,
    CatalogItemImagesService,
    CatalogDuplicatePolicyService,
    CatalogItemsService,
    CatalogNegotiationPolicyService,
    ChatApiService,
    ExchangeDisputesService,
    ExchangeProposalsService,
    ExchangeMatchesService,
    IdentitySignalsService,
  ],
})
export class CatalogModule {}
