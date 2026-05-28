import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  CatalogItemCondition,
  CatalogItemPublicationStatus,
} from '../catalog.constants';
import { Type } from 'class-transformer';
import { CatalogItemImageInputDto } from './catalog-item-image-input.dto';

export class CreateCatalogItemDto {
  @IsString()
  @MinLength(3)
  @MaxLength(140)
  title!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description!: string;

  @IsString()
  categoryId!: string;

  @IsEnum(CatalogItemCondition)
  condition!: CatalogItemCondition;

  @IsOptional()
  @IsInt()
  @Min(0)
  subjectiveValue?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  exchangePreferences?: string;

  @IsOptional()
  @IsEnum(CatalogItemPublicationStatus)
  publicationStatus?: CatalogItemPublicationStatus;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CatalogItemImageInputDto)
  images?: CatalogItemImageInputDto[];
}
