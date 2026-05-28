import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

export class UpdateAdminExchangeMatchStatusDto {
  @IsIn(['COMPLETED', 'CANCELLED', 'NOT_CONCRETED', 'EXPIRED'])
  status!: 'COMPLETED' | 'CANCELLED' | 'NOT_CONCRETED' | 'EXPIRED'

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}

