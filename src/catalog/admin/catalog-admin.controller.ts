import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { AdminJwtAuthGuard } from '../../auth/guards/admin-jwt-auth.guard'
import { AdminPermissionsGuard } from '../../auth/guards/admin-permissions.guard'
import { CurrentAdminUser } from '../../auth/decorators/current-admin-user.decorator'
import { RequireAdminPermissions } from '../../auth/decorators/require-admin-permissions.decorator'
import { AuthenticatedAdminRequestUser } from '../../auth/interfaces/admin-authenticated-request.interface'
import { CatalogAdminExchangesService } from './catalog-admin-exchanges.service'
import { CatalogAdminQueueService } from './catalog-admin-queue.service'
import { CatalogImageModerationService } from '../moderation/catalog-image-moderation.service'
import { CatalogItemsService } from '../items/catalog-items.service'
import { CatalogPublicationModerationService } from '../moderation/catalog-publication-moderation.service'
import { CatalogAdminMetricsService } from './catalog-admin-metrics.service'
import { ExchangeDisputesService } from '../exchanges/exchange-disputes.service'
import { AddExchangeDisputeMessageDto } from '../dto/add-exchange-dispute-message.dto'
import { AdminQueueQueryDto } from '../dto/admin-queue-query.dto'
import { DeleteAdminCatalogItemDto } from '../dto/delete-admin-catalog-item.dto'
import { ListAdminExchangesQueryDto } from '../dto/list-admin-exchanges-query.dto'
import { ListAdminCatalogMetricsQueryDto } from '../dto/list-admin-catalog-metrics-query.dto'
import { ListAdminProductModerationQueryDto } from '../dto/list-admin-product-moderation-query.dto'
import { ListCatalogItemReportsQueryDto } from '../dto/list-catalog-item-reports-query.dto'
import { ListCatalogItemsQueryDto } from '../dto/list-catalog-items-query.dto'
import { ListExchangeDisputesQueryDto } from '../dto/list-exchange-disputes-query.dto'
import { ListModerationAppealsQueryDto } from '../dto/list-moderation-appeals-query.dto'
import { ResolveCatalogItemReportDto } from '../dto/resolve-catalog-item-report.dto'
import { ResolveModerationAppealDto } from '../dto/resolve-moderation-appeal.dto'
import { ResolveModerationReviewDto } from '../dto/resolve-moderation-review.dto'
import { UpdateAdminExchangeMatchStatusDto } from '../dto/update-admin-exchange-match-status.dto'
import { UpdateAdminExchangeDisputeDto } from '../dto/update-admin-exchange-dispute.dto'
import { UpdateAdminCatalogItemStatusDto } from '../dto/update-admin-catalog-item-status.dto'

@Controller('catalog/admin')
@UseGuards(AdminJwtAuthGuard, AdminPermissionsGuard)
export class CatalogAdminController {
  constructor(
    private readonly catalogImageModerationService: CatalogImageModerationService,
    private readonly catalogItemsService: CatalogItemsService,
    private readonly catalogAdminMetricsService: CatalogAdminMetricsService,
    private readonly catalogAdminExchangesService: CatalogAdminExchangesService,
    private readonly catalogAdminQueueService: CatalogAdminQueueService,
    private readonly catalogPublicationModerationService: CatalogPublicationModerationService,
    private readonly exchangeDisputesService: ExchangeDisputesService,
  ) {}

  @Get('products')
  @RequireAdminPermissions('catalog.products.read')
  listProducts(@Query() query: ListCatalogItemsQueryDto) {
    return this.catalogItemsService.listAdminItems(query)
  }

  @Get('metrics')
  @RequireAdminPermissions('stats.read')
  getMetrics(@Query() query: ListAdminCatalogMetricsQueryDto) {
    return this.catalogAdminMetricsService.getMetrics(query)
  }

  @Get('workers/queue')
  @RequireAdminPermissions('workers.read')
  getWorkerQueue(@Query() query: AdminQueueQueryDto) {
    return this.catalogAdminQueueService.getSnapshot(query)
  }

  @Post('workers/queue/pause')
  @RequireAdminPermissions('workers.manage')
  pauseWorkerQueue() {
    return this.catalogAdminQueueService.pause()
  }

  @Post('workers/queue/resume')
  @RequireAdminPermissions('workers.manage')
  resumeWorkerQueue() {
    return this.catalogAdminQueueService.resume()
  }

  @Post('workers/queue/jobs/:jobId/retry')
  @RequireAdminPermissions('workers.manage')
  retryWorkerJob(@Param('jobId') jobId: string) {
    return this.catalogAdminQueueService.retry(jobId)
  }

  @Post('workers/catalog-items/:itemId/retry-moderation')
  @RequireAdminPermissions('workers.manage')
  retryCatalogItemModeration(@Param('itemId', new ParseUUIDPipe()) itemId: string) {
    return this.catalogPublicationModerationService.queuePublicationReview(itemId)
  }

  @Get('exchanges')
  @RequireAdminPermissions('exchanges.read')
  listExchanges(@Query() query: ListAdminExchangesQueryDto) {
    return this.catalogAdminExchangesService.listExchanges(query)
  }

  @Patch('matches/:matchId/status')
  @RequireAdminPermissions('exchanges.manage')
  updateMatchStatus(
    @CurrentAdminUser() adminUser: AuthenticatedAdminRequestUser,
    @Param('matchId', new ParseUUIDPipe()) matchId: string,
    @Body() dto: UpdateAdminExchangeMatchStatusDto,
  ) {
    return this.catalogAdminExchangesService.updateMatchStatus(
      matchId,
      dto,
      adminUser.adminUserId,
    )
  }

  @Get('disputes')
  @RequireAdminPermissions('claims.read')
  listDisputes(@Query() query: ListExchangeDisputesQueryDto) {
    return this.exchangeDisputesService.listAdminDisputes(query)
  }

  @Get('disputes/:disputeId')
  @RequireAdminPermissions('claims.read')
  getDispute(@Param('disputeId', new ParseUUIDPipe()) disputeId: string) {
    return this.exchangeDisputesService.getAdminDispute(disputeId)
  }

  @Post('disputes/:disputeId/messages')
  @RequireAdminPermissions('claims.resolve')
  addDisputeMessage(
    @CurrentAdminUser() adminUser: AuthenticatedAdminRequestUser,
    @Param('disputeId', new ParseUUIDPipe()) disputeId: string,
    @Body() dto: AddExchangeDisputeMessageDto,
  ) {
    return this.exchangeDisputesService.addAdminMessage(
      adminUser.adminUserId,
      disputeId,
      dto,
    )
  }

  @Patch('disputes/:disputeId')
  @RequireAdminPermissions('claims.resolve')
  updateDispute(
    @CurrentAdminUser() adminUser: AuthenticatedAdminRequestUser,
    @Param('disputeId', new ParseUUIDPipe()) disputeId: string,
    @Body() dto: UpdateAdminExchangeDisputeDto,
  ) {
    return this.exchangeDisputesService.updateAdminDispute(
      adminUser.adminUserId,
      disputeId,
      dto,
    )
  }

  @Get('moderation/products')
  @RequireAdminPermissions('catalog.products.read')
  listProductModerationQueue(
    @Query() query: ListAdminProductModerationQueryDto,
  ) {
    return this.catalogImageModerationService.listAdminProductModerationQueue(
      query,
    )
  }

  @Post('reviews/:moderationId/resolve')
  @RequireAdminPermissions('catalog.products.moderate')
  resolveReview(
    @Param('moderationId') moderationId: string,
    @Body() resolveReviewDto: ResolveModerationReviewDto,
  ) {
    return this.catalogImageModerationService.resolveReview(
      moderationId,
      resolveReviewDto,
    )
  }

  @Get('reports')
  @RequireAdminPermissions('catalog.reports.read')
  listReports(@Query() query: ListCatalogItemReportsQueryDto) {
    return this.catalogImageModerationService.listReports(query)
  }

  @Post('reports/:reportId/resolve')
  @RequireAdminPermissions('catalog.reports.resolve')
  resolveReport(
    @Param('reportId') reportId: string,
    @Body() resolveReportDto: ResolveCatalogItemReportDto,
  ) {
    return this.catalogImageModerationService.resolveReport(
      reportId,
      resolveReportDto,
    )
  }

  @Get('appeals')
  @RequireAdminPermissions('catalog.appeals.read')
  listAppeals(@Query() query: ListModerationAppealsQueryDto) {
    return this.catalogImageModerationService.listAppeals(query)
  }

  @Post('appeals/:appealId/resolve')
  @RequireAdminPermissions('catalog.appeals.resolve')
  resolveAppeal(
    @Param('appealId') appealId: string,
    @Body() resolveAppealDto: ResolveModerationAppealDto,
  ) {
    return this.catalogImageModerationService.resolveAppeal(
      appealId,
      resolveAppealDto,
    )
  }

  @Patch('products/:itemId/status')
  @RequireAdminPermissions('catalog.products.moderate')
  updateProductStatus(
    @Param('itemId') itemId: string,
    @Body() updateDto: UpdateAdminCatalogItemStatusDto,
  ) {
    return this.catalogItemsService.adminUpdatePublicationStatus(
      itemId,
      updateDto.publicationStatus,
    )
  }

  @Delete('products/:itemId')
  @RequireAdminPermissions('catalog.products.moderate')
  deleteProduct(
    @Param('itemId') itemId: string,
    @Body() deleteDto: DeleteAdminCatalogItemDto,
  ) {
    return this.catalogItemsService.adminDeleteItem(itemId, deleteDto.reason)
  }
}
