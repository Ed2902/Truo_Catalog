import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'
import {
  ExchangeDisputeStatus,
  ExchangeMatchStatus,
} from '../shared/catalog.constants'

export class UpdateAdminExchangeDisputeDto {
  @IsOptional()
  @IsEnum(ExchangeDisputeStatus)
  status?: ExchangeDisputeStatus

  @IsOptional()
  @IsString()
  @MaxLength(120)
  assignedAdminUserId?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolution?: string

  @IsOptional()
  @IsEnum(ExchangeMatchStatus)
  matchStatus?: ExchangeMatchStatus
}
