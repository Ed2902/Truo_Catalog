import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'

export enum ResolveModerationReviewAction {
  APPROVE = 'APPROVE',
  REMOVE_PRODUCT = 'REMOVE_PRODUCT',
}

export class ResolveModerationReviewDto {
  @IsEnum(ResolveModerationReviewAction)
  action!: ResolveModerationReviewAction

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string

  @IsOptional()
  @IsString()
  @MaxLength(140)
  reviewerUserId?: string
}

