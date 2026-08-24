import { Transform } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export class AdminQueueQueryDto {
  @IsOptional()
  @IsString()
  state?: string

  @IsOptional()
  @IsString()
  queueKey?: string

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number
}

