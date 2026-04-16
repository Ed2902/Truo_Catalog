import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CloseExchangeMatchDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
