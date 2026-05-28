import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class AddExchangeDisputeMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string

  @IsOptional()
  @IsBoolean()
  isInternalNote?: boolean
}
