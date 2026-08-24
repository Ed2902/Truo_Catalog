import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { CatalogItemReportStatus } from '../shared/catalog.constants'

export class ListCatalogItemReportsQueryDto {
  @IsOptional()
  @IsEnum(CatalogItemReportStatus)
  status?: CatalogItemReportStatus

  @IsOptional()
  @IsString()
  reporterUserId?: string

  @IsOptional()
  @IsString()
  ownerUserId?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5000)
  skip?: number
}
