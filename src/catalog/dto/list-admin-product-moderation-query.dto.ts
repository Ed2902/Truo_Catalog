import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator'

export class ListAdminProductModerationQueryDto {
  @IsOptional()
  @IsIn(['all', 'pending', 'blocked'])
  status?: 'all' | 'pending' | 'blocked'

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number
}
