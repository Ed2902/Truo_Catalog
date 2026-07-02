import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Request } from 'express'

@Injectable()
export class CatalogInternalTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const token = this.configService.get<string | undefined>(
      'catalogInternal.token'
    )

    if (!token) {
      throw new UnauthorizedException('Catalog internal token is not configured')
    }

    const request = context.switchToHttp().getRequest<Request>()
    const headerToken = request.header('x-internal-token')

    if (!headerToken || headerToken !== token) {
      throw new UnauthorizedException('Invalid catalog internal token')
    }

    return true
  }
}
