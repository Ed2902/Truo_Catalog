import { Transform } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { ExchangeDisputeStatus } from '../shared/catalog.constants'

export class ListExchangeDisputesQueryDto {
  @IsOptional()
  @IsString()
  q?: string

  @IsOptional()
  @IsString()
  userId?: string

  @IsOptional()
  @IsString()
  matchId?: string

  @IsOptional()
  @IsEnum(ExchangeDisputeStatus)
  status?: ExchangeDisputeStatus

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number
}
