import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { CatalogModerationAppealStatus } from '../shared/catalog.constants'

export class ListModerationAppealsQueryDto {
  @IsOptional()
  @IsEnum(CatalogModerationAppealStatus)
  status?: CatalogModerationAppealStatus

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
