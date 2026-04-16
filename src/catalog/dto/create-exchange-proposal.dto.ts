import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateExchangeProposalDto {
  @IsString()
  requestedItemId!: string;

  @IsString()
  offeredItemId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
