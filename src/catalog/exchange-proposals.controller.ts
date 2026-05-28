import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { CurrentCatalogActor } from './decorators/current-catalog-actor.decorator';
import { CreateExchangeProposalDto } from './dto/create-exchange-proposal.dto';
import { ExchangeProposalsService } from './exchange-proposals.service';
import { CatalogActor } from './interfaces/catalog-actor.interface';

@Controller('catalog/exchange-proposals')
export class ExchangeProposalsController {
  constructor(
    private readonly exchangeProposalsService: ExchangeProposalsService,
  ) {}

  @Post()
  createProposal(
    @CurrentCatalogActor() actor: CatalogActor,
    @Body() createExchangeProposalDto: CreateExchangeProposalDto,
    @Req() request: Request,
  ) {
    return this.exchangeProposalsService.createProposal(
      actor,
      createExchangeProposalDto,
      request,
    );
  }

  @Get('me')
  listMyProposals(@CurrentCatalogActor() actor: CatalogActor) {
    return this.exchangeProposalsService.listMyProposals(actor);
  }

  @Post(':proposalId/accept')
  acceptProposal(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('proposalId') proposalId: string,
  ) {
    return this.exchangeProposalsService.acceptProposal(actor, proposalId);
  }

  @Post(':proposalId/reject')
  rejectProposal(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('proposalId') proposalId: string,
  ) {
    return this.exchangeProposalsService.rejectProposal(actor, proposalId);
  }

  @Post(':proposalId/cancel')
  cancelProposal(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('proposalId') proposalId: string,
  ) {
    return this.exchangeProposalsService.cancelProposal(actor, proposalId);
  }
}
