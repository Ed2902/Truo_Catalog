import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'

export enum ResolveModerationAppealAction {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export class ResolveModerationAppealDto {
  @IsEnum(ResolveModerationAppealAction)
  action!: ResolveModerationAppealAction

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  resolutionMessage?: string

  @IsOptional()
  @IsString()
  @MaxLength(140)
  reviewerUserId?: string
}

