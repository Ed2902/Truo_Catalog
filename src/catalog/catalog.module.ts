import { Module } from '@nestjs/common';
import { CatalogCategoriesController } from './catalog-categories.controller';
import { CatalogCategoriesService } from './catalog-categories.service';
import { CatalogDuplicatePolicyService } from './catalog-duplicate-policy.service';
import { CatalogItemsController } from './catalog-items.controller';
import { CatalogItemsService } from './catalog-items.service';
import { CatalogNegotiationPolicyService } from './catalog-negotiation-policy.service';
import { ExchangeProposalsController } from './exchange-proposals.controller';
import { ExchangeProposalsService } from './exchange-proposals.service';
import { IdentitySignalsService } from './identity/identity-signals.service';

@Module({
  controllers: [
    CatalogCategoriesController,
    CatalogItemsController,
    ExchangeProposalsController,
  ],
  providers: [
    CatalogCategoriesService,
    CatalogDuplicatePolicyService,
    CatalogItemsService,
    CatalogNegotiationPolicyService,
    ExchangeProposalsService,
    IdentitySignalsService,
  ],
})
export class CatalogModule {}
