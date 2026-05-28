import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { CatalogItemReportReason } from '../shared/catalog.constants'

export class CreateCatalogItemReportDto {
  @IsEnum(CatalogItemReportReason)
  reason!: CatalogItemReportReason

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  details?: string
}
