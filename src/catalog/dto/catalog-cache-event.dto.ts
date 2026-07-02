import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator'

export const catalogCacheEventTypes = [
  'product.created',
  'product.updated',
  'product.deleted',
  'avatar.updated',
  'premium.updated',
  'follow.created',
  'follow.deleted',
  'block.created',
  'block.deleted',
  'restriction.created',
  'restriction.updated',
  'rating.updated',
  'story.created',
  'story.expired',
  'negotiation.updated',
  'media.updated',
] as const

export class CatalogCacheEventDto {
  @IsIn(catalogCacheEventTypes)
  eventType!: (typeof catalogCacheEventTypes)[number]

  @IsOptional()
  @IsString()
  itemId?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  itemIds?: string[]

  @IsOptional()
  @IsString()
  ownerUserId?: string

  @IsOptional()
  @IsString()
  viewerUserId?: string

  @IsOptional()
  @IsString()
  storagePath?: string

  @IsOptional()
  @IsBoolean()
  securitySensitive?: boolean
}
