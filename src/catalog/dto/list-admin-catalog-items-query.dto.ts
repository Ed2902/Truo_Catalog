import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator'
import { Type } from 'class-transformer'
import { CatalogItemPublicationStatus } from '../shared/catalog.constants'

export class ListAdminCatalogItemsQueryDto {
  @IsOptional()
  @IsString()
  categoryId?: string

  @IsOptional()
  @IsString()
  ownerUserId?: string

  @IsOptional()
  @IsString()
  search?: string

  @IsOptional()
  @IsEnum(CatalogItemPublicationStatus)
  publicationStatus?: CatalogItemPublicationStatus

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
