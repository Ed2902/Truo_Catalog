import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Request } from 'express'

@Injectable()
export class ModerationInternalTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configuredToken = this.configService.get<string>(
      'moderation.internalToken',
    )

    if (!configuredToken) {
      throw new UnauthorizedException('Moderation internal token is not configured')
    }

    const request = context.switchToHttp().getRequest<Request>()
    const headerToken = request.header('x-internal-token')
    const bearerToken = this.extractBearerToken(request.header('authorization'))
    const providedToken = headerToken ?? bearerToken

    if (providedToken !== configuredToken) {
      throw new UnauthorizedException('Invalid moderation internal token')
    }

    return true
  }

  private extractBearerToken(authorizationHeader?: string): string | null {
    if (!authorizationHeader) {
      return null
    }

    const [scheme, token] = authorizationHeader.split(' ')
    return scheme === 'Bearer' && token?.trim() ? token.trim() : null
  }
}
