import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateCatalogItemImageUploadUrlDto {
  @IsString()
  mimeType!: string;

  @IsString()
  fileName!: string;

  @IsInt()
  @Min(1)
  size!: number;

  @IsOptional()
  @IsBoolean()
  replaceExistingImages?: boolean;
}
