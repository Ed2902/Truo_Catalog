import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { StorageModule } from '../storage/storage.module'
import { CatalogItemImagesController } from './catalog-item-images.controller'
import { CatalogItemImagesService } from './catalog-item-images.service'
import { CatalogCategoriesController } from './catalog-categories.controller'
import { CatalogCategoriesService } from './catalog-categories.service'
import { CatalogDuplicatePolicyService } from './catalog-duplicate-policy.service'
import { CatalogItemsController } from './catalog-items.controller'
import { CatalogItemsService } from './catalog-items.service'
import { CatalogNegotiationPolicyService } from './catalog-negotiation-policy.service'
import { ExchangeProposalsController } from './exchange-proposals.controller'
import { ExchangeProposalsService } from './exchange-proposals.service'
import { ExchangeMatchesController } from './exchange-matches.controller'
import { ExchangeMatchesService } from './exchange-matches.service'
import { IdentitySignalsService } from './identity/identity-signals.service'

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [
    CatalogCategoriesController,
    CatalogItemImagesController,
    CatalogItemsController,
    ExchangeProposalsController,
    ExchangeMatchesController,
  ],
  providers: [
    CatalogCategoriesService,
    CatalogItemImagesService,
    CatalogDuplicatePolicyService,
    CatalogItemsService,
    CatalogNegotiationPolicyService,
    ExchangeProposalsService,
    ExchangeMatchesService,
  ],
})
export class CatalogModule {}
