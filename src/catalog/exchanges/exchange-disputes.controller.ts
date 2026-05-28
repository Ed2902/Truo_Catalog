import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { SensitiveRateLimit } from '../../common/decorators/sensitive-rate-limit.decorator'
import { CurrentCatalogActor } from '../decorators/current-catalog-actor.decorator'
import { AddExchangeDisputeMessageDto } from '../dto/add-exchange-dispute-message.dto'
import { CreateExchangeDisputeDto } from '../dto/create-exchange-dispute.dto'
import { ExchangeDisputesService } from './exchange-disputes.service'
import { CatalogActor } from '../interfaces/catalog-actor.interface'

@Controller('catalog/exchange-disputes')
@UseGuards(JwtAuthGuard)
export class ExchangeDisputesController {
  constructor(private readonly exchangeDisputesService: ExchangeDisputesService) {}

  @Post()
  @SensitiveRateLimit()
  createDispute(
    @CurrentCatalogActor() actor: CatalogActor,
    @Body() dto: CreateExchangeDisputeDto,
  ) {
    return this.exchangeDisputesService.createDispute(actor, dto)
  }

  @Get('me')
  listMyDisputes(@CurrentCatalogActor() actor: CatalogActor) {
    return this.exchangeDisputesService.listMyDisputes(actor)
  }

  @Get(':disputeId')
  getMyDispute(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('disputeId') disputeId: string,
  ) {
    return this.exchangeDisputesService.getMyDispute(actor, disputeId)
  }

  @Post(':disputeId/messages')
  @SensitiveRateLimit()
  addUserMessage(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('disputeId') disputeId: string,
    @Body() dto: AddExchangeDisputeMessageDto,
  ) {
    return this.exchangeDisputesService.addUserMessage(actor, disputeId, dto)
  }
}
