import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { REQUIRED_ADMIN_PERMISSIONS_KEY } from '../decorators/require-admin-permissions.decorator'
import { RequestWithAdminUser } from '../interfaces/admin-authenticated-request.interface'

@Injectable()
export class AdminPermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions =
      this.reflector.getAllAndOverride<string[]>(
        REQUIRED_ADMIN_PERMISSIONS_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? []

    if (requiredPermissions.length === 0) {
      return true
    }

    const request = context.switchToHttp().getRequest<RequestWithAdminUser>()
    const adminUser = request.adminUser

    if (!adminUser) {
      throw new ForbiddenException('Admin user is required')
    }

    if (adminUser.permissions.includes('*')) {
      return true
    }

    const missingPermission = requiredPermissions.find(
      (permission) => !adminUser.permissions.includes(permission),
    )

    if (missingPermission) {
      throw new ForbiddenException('Missing admin permission')
    }

    return true
  }
}
