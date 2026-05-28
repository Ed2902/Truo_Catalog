import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator'
import { ExchangeDisputeReason } from '../shared/catalog.constants'

export class CreateExchangeDisputeDto {
  @IsString()
  matchId!: string

  @IsEnum(ExchangeDisputeReason)
  reason!: ExchangeDisputeReason

  @IsString()
  @MinLength(5)
  @MaxLength(160)
  title!: string

  @IsString()
  @MinLength(20)
  @MaxLength(2000)
  description!: string
}
