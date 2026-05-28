import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { SensitiveRateLimit } from '../../common/decorators/sensitive-rate-limit.decorator'
import { CatalogImageModerationService } from './catalog-image-moderation.service'
import { CurrentCatalogActor } from '../decorators/current-catalog-actor.decorator'
import { CreateCatalogItemReportDto } from '../dto/create-catalog-item-report.dto'
import { CreateModerationAppealDto } from '../dto/create-moderation-appeal.dto'
import { ListCatalogItemReportsQueryDto } from '../dto/list-catalog-item-reports-query.dto'
import { ListModerationAppealsQueryDto } from '../dto/list-moderation-appeals-query.dto'
import { ListModerationReviewsQueryDto } from '../dto/list-moderation-reviews-query.dto'
import { ResolveCatalogItemReportDto } from '../dto/resolve-catalog-item-report.dto'
import { ResolveModerationAppealDto } from '../dto/resolve-moderation-appeal.dto'
import { ResolveModerationReviewDto } from '../dto/resolve-moderation-review.dto'
import { ModerationInternalTokenGuard } from '../guards/moderation-internal-token.guard'
import { CatalogActor } from '../interfaces/catalog-actor.interface'

@Controller('catalog/moderation')
export class CatalogModerationController {
  constructor(
    private readonly catalogImageModerationService: CatalogImageModerationService,
  ) {}

  @Post('items/:itemId/reports')
  @UseGuards(JwtAuthGuard)
  @SensitiveRateLimit()
  createReport(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('itemId') itemId: string,
    @Body() createReportDto: CreateCatalogItemReportDto,
  ) {
    return this.catalogImageModerationService.createReport(
      actor,
      itemId,
      createReportDto,
    )
  }

  @Post('items/:itemId/appeals')
  @UseGuards(JwtAuthGuard)
  @SensitiveRateLimit()
  createAppeal(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('itemId') itemId: string,
    @Body() createAppealDto: CreateModerationAppealDto,
  ) {
    return this.catalogImageModerationService.createAppeal(
      actor,
      itemId,
      createAppealDto,
    )
  }

  @Get('items/:itemId/appeals')
  @UseGuards(JwtAuthGuard)
  listMyAppeals(
    @CurrentCatalogActor() actor: CatalogActor,
    @Param('itemId') itemId: string,
  ) {
    return this.catalogImageModerationService.listMyAppeals(actor, itemId)
  }

  @Get('internal/reviews')
  @UseGuards(ModerationInternalTokenGuard)
  listReviews(@Query() query: ListModerationReviewsQueryDto) {
    return this.catalogImageModerationService.listReviews(query)
  }

  @Get('internal/blocked')
  @UseGuards(ModerationInternalTokenGuard)
  listBlocked(@Query() query: ListModerationReviewsQueryDto) {
    return this.catalogImageModerationService.listBlocked(query)
  }

  @Get('internal/reports')
  @UseGuards(ModerationInternalTokenGuard)
  listReports(@Query() query: ListCatalogItemReportsQueryDto) {
    return this.catalogImageModerationService.listReports(query)
  }

  @Post('internal/reports/:reportId/resolve')
  @UseGuards(ModerationInternalTokenGuard)
  resolveReport(
    @Param('reportId') reportId: string,
    @Body() resolveReportDto: ResolveCatalogItemReportDto,
  ) {
    return this.catalogImageModerationService.resolveReport(
      reportId,
      resolveReportDto,
    )
  }

  @Post('internal/reviews/:moderationId/resolve')
  @UseGuards(ModerationInternalTokenGuard)
  resolveReview(
    @Param('moderationId') moderationId: string,
    @Body() resolveReviewDto: ResolveModerationReviewDto,
  ) {
    return this.catalogImageModerationService.resolveReview(
      moderationId,
      resolveReviewDto,
    )
  }

  @Get('internal/appeals')
  @UseGuards(ModerationInternalTokenGuard)
  listAppeals(@Query() query: ListModerationAppealsQueryDto) {
    return this.catalogImageModerationService.listAppeals(query)
  }

  @Post('internal/appeals/:appealId/resolve')
  @UseGuards(ModerationInternalTokenGuard)
  resolveAppeal(
    @Param('appealId') appealId: string,
    @Body() resolveAppealDto: ResolveModerationAppealDto,
  ) {
    return this.catalogImageModerationService.resolveAppeal(
      appealId,
      resolveAppealDto,
    )
  }
}
