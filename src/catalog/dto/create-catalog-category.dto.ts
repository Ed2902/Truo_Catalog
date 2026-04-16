import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCatalogCategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}
