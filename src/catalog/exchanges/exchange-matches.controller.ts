import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { SensitiveRateLimit } from '../../common/decorators/sensitive-rate-limit.decorator'
import { CurrentCatalogActor } from '../decorators/current-catalog-actor.decorator'
import { CloseExchangeMatchDto } from '../dto/close-exchange-match.dto'
import { SubmitExchangeMatchFeedbackDto } from '../dto/submit-exchange-match-feedback.dto'
import { ExchangeMatchesService } from './exchange-matches.service'
import { CatalogActor } from '../interfaces/catalog-actor.interface'

@Controller('catalog/exchange-matches')
export class ExchangeMatchesController {
  constructor(
    private readonly exchangeMatchesService: ExchangeMatchesService
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  listMyMatches(@CurrentCatalogActor() actor: CatalogActor) {
    return this.exchangeMatchesService.listMyMatches(actor)
  }

  @Get(':matchId')
  @UseGuards(JwtAuthGuard)
  getMatch(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('matchId') matchId: string
  ) {
    return this.exchangeMatchesService.getMatch(actor, matchId)
  }

  @Post(':matchId/open-chat')
  @UseGuards(JwtAuthGuard)
  @SensitiveRateLimit()
  openChat(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('matchId') matchId: string
  ) {
    return this.exchangeMatchesService.ensureChatForMatch(actor, matchId)
  }

  @Post(':matchId/complete')
  @UseGuards(JwtAuthGuard)
  @SensitiveRateLimit()
  markCompleted(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('matchId') matchId: string,
    @Body() closeExchangeMatchDto: CloseExchangeMatchDto
  ) {
    return this.exchangeMatchesService.markMatchCompleted(
      actor,
      matchId,
      closeExchangeMatchDto
    )
  }

  @Post(':matchId/not-concreted')
  @UseGuards(JwtAuthGuard)
  @SensitiveRateLimit()
  markNotConcreted(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('matchId') matchId: string,
    @Body() closeExchangeMatchDto: CloseExchangeMatchDto
  ) {
    return this.exchangeMatchesService.markMatchNotConcreted(
      actor,
      matchId,
      closeExchangeMatchDto
    )
  }

  @Post(':matchId/cancel')
  @UseGuards(JwtAuthGuard)
  @SensitiveRateLimit()
  cancel(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('matchId') matchId: string,
    @Body() closeExchangeMatchDto: CloseExchangeMatchDto
  ) {
    return this.exchangeMatchesService.cancelMatch(
      actor,
      matchId,
      closeExchangeMatchDto
    )
  }

  @Post(':matchId/expire')
  @UseGuards(JwtAuthGuard)
  @SensitiveRateLimit()
  expire(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('matchId') matchId: string,
    @Body() closeExchangeMatchDto: CloseExchangeMatchDto
  ) {
    return this.exchangeMatchesService.expireMatch(
      actor,
      matchId,
      closeExchangeMatchDto
    )
  }

  @Post(':matchId/feedback')
  @UseGuards(JwtAuthGuard)
  @SensitiveRateLimit()
  submitFeedback(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('matchId') matchId: string,
    @Body() dto: SubmitExchangeMatchFeedbackDto
  ) {
    return this.exchangeMatchesService.submitMatchFeedback(actor, matchId, dto)
  }
}
