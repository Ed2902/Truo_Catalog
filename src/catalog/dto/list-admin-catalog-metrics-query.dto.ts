import { IsDateString, IsOptional } from 'class-validator'

export class ListAdminCatalogMetricsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string

  @IsOptional()
  @IsDateString()
  to?: string
}
