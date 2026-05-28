import { IsOptional, IsString, MaxLength } from 'class-validator'

export class DeleteAdminCatalogItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string
}
