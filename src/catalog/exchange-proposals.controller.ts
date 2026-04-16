import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { Request } from 'express'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard'
import { RequestWithAuthenticatedUser } from '../auth/interfaces/authenticated-request.interface'
import { SensitiveRateLimit } from '../common/decorators/sensitive-rate-limit.decorator'
import {
  CurrentCatalogActor,
  resolveCatalogActorFromRequest,
} from './decorators/current-catalog-actor.decorator'
import { CreateExchangeProposalDto } from './dto/create-exchange-proposal.dto'
import { RespondExchangeProposalDto } from './dto/respond-exchange-proposal.dto'
import { ExchangeProposalsService } from './exchange-proposals.service'
import { CatalogActor } from './interfaces/catalog-actor.interface'

@Controller('catalog/exchange-proposals')
export class ExchangeProposalsController {
  constructor(
    private readonly exchangeProposalsService: ExchangeProposalsService
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @SensitiveRateLimit()
  createProposal(
    @CurrentCatalogActor() actor: CatalogActor,
    @Body() createExchangeProposalDto: CreateExchangeProposalDto,
    @Req() request: Request
  ) {
    return this.exchangeProposalsService.createProposal(
      actor,
      createExchangeProposalDto,
      request
    )
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  listMyProposals(@CurrentCatalogActor() actor: CatalogActor) {
    return this.exchangeProposalsService.listMyProposals(actor)
  }

  @Get('public/requested-item/:itemId')
  @UseGuards(OptionalJwtAuthGuard)
  listPublicProposalsForRequestedItem(
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Req() request: Request
  ) {
    const actor = resolveCatalogActorFromRequest(
      request as RequestWithAuthenticatedUser
    )

    return this.exchangeProposalsService.listPublicProposalsForRequestedItem(
      itemId,
      actor
    )
  }

  @Post(':proposalId/accept')
  @UseGuards(JwtAuthGuard)
  @SensitiveRateLimit()
  acceptProposal(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('proposalId') proposalId: string
  ) {
    return this.exchangeProposalsService.acceptProposal(actor, proposalId)
  }

  @Post(':proposalId/reject')
  @UseGuards(JwtAuthGuard)
  @SensitiveRateLimit()
  rejectProposal(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('proposalId') proposalId: string
  ) {
    return this.exchangeProposalsService.rejectProposal(actor, proposalId)
  }

  @Post(':proposalId/cancel')
  @UseGuards(JwtAuthGuard)
  @SensitiveRateLimit()
  cancelProposal(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('proposalId') proposalId: string
  ) {
    return this.exchangeProposalsService.cancelProposal(actor, proposalId)
  }

  @Post(':proposalId/respond-message')
  @UseGuards(JwtAuthGuard)
  @SensitiveRateLimit()
  respondProposalMessage(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('proposalId') proposalId: string,
    @Body() respondExchangeProposalDto: RespondExchangeProposalDto
  ) {
    return this.exchangeProposalsService.respondToProposal(
      actor,
      proposalId,
      respondExchangeProposalDto
    )
  }
}
