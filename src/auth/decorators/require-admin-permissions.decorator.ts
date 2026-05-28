import { SetMetadata } from '@nestjs/common'

export const REQUIRED_ADMIN_PERMISSIONS_KEY = 'requiredAdminPermissions'

export const RequireAdminPermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRED_ADMIN_PERMISSIONS_KEY, permissions)
