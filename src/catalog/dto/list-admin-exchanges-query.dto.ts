import { Transform } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export class ListAdminExchangesQueryDto {
  @IsOptional()
  @IsString()
  q?: string

  @IsOptional()
  @IsString()
  userId?: string

  @IsOptional()
  @IsIn(['ACTIVE', 'COMPLETED', 'CANCELLED', 'NOT_CONCRETED', 'EXPIRED'])
  matchStatus?: 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'NOT_CONCRETED' | 'EXPIRED'

  @IsOptional()
  @IsIn(['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED'])
  proposalStatus?: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED'

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number
}

