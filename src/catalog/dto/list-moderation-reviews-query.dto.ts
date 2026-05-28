import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { CatalogImageModerationStatus } from '../shared/catalog.constants'

export class ListModerationReviewsQueryDto {
  @IsOptional()
  @IsEnum(CatalogImageModerationStatus)
  status?: CatalogImageModerationStatus

  @IsOptional()
  @IsString()
  ownerUserId?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number
}
