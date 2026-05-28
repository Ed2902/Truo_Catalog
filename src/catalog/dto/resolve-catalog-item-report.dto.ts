import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'

export enum ResolveCatalogItemReportAction {
  DISMISS = 'DISMISS',
  SEND_TO_REVIEW = 'SEND_TO_REVIEW',
  REMOVE_PRODUCT = 'REMOVE_PRODUCT',
}

export class ResolveCatalogItemReportDto {
  @IsEnum(ResolveCatalogItemReportAction)
  action!: ResolveCatalogItemReportAction

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reviewerUserId?: string
}
