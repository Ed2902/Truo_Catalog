import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

export class CatalogItemImageInputDto {
  @IsOptional()
  @IsUrl()
  storageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  storagePath?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isCover?: boolean;
}
