import { IsEnum } from 'class-validator'
import { CatalogItemPublicationStatus } from '../shared/catalog.constants'

export class UpdateAdminCatalogItemStatusDto {
  @IsEnum(CatalogItemPublicationStatus)
  publicationStatus!: CatalogItemPublicationStatus
}
