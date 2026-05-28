import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

export class SubmitExchangeMatchFeedbackDto {
  @IsBoolean()
  wasEffectiveInPerson!: boolean

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string
}
