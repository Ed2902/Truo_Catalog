import { IsInt, IsString, Min } from 'class-validator';

export class CreateCatalogItemImageUploadUrlDto {
  @IsString()
  mimeType!: string;

  @IsString()
  fileName!: string;

  @IsInt()
  @Min(1)
  size!: number;
}
