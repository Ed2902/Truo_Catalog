import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SecurityLoggerService } from '../../logger/security-logger.service';
import { IdentitySignalsService } from '../../catalog/identity/identity-signals.service';
import { RequestWithAuthenticatedUser } from '../interfaces/authenticated-request.interface';
import { JwtAccessTokenPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly identitySignalsService: IdentitySignalsService,
    private readonly securityLogger: SecurityLoggerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request =
      context.switchToHttp().getRequest<RequestWithAuthenticatedUser>();
    const token = this.extractBearerToken(request);

    if (!token) {
      return true;
    }

    let payload: JwtAccessTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtAccessTokenPayload>(token, {
        secret: this.configService.getOrThrow<string>('auth.accessTokenSecret'),
      });
    } catch (error) {
      this.securityLogger.log('auth.catalog_optional_request', 'failure', {
        ipAddress: request.ip,
        userAgent: request.header('user-agent'),
        reason: 'invalid_bearer_token',
        metadata: {
          error: error instanceof Error ? error.message : 'unknown_error',
        },
      });
      throw new UnauthorizedException('Invalid access token');
    }

    if (
      payload.typ !== 'access' ||
      !payload.sub?.trim() ||
      !payload.sid?.trim()
    ) {
      this.securityLogger.log('auth.catalog_optional_request', 'failure', {
        ipAddress: request.ip,
        userAgent: request.header('user-agent'),
        reason: 'invalid_access_token_payload',
      });
      throw new UnauthorizedException('Invalid access token');
    }

    request.user = {
      userId: payload.sub,
      sessionId: payload.sid,
      email: payload.email,
      tokenType: 'access',
    };

    try {
      request.catalogActor =
        await this.identitySignalsService.resolveAuthenticatedActor(
          request.user,
          request,
          token,
        );
    } catch (error) {
      this.securityLogger.log('auth.catalog_optional_request', 'denied', {
        actorUserId: request.user.userId,
        actorSessionId: request.user.sessionId,
        ipAddress: request.ip,
        userAgent: request.header('user-agent'),
        reason: 'identity_resolution_failed',
        metadata: {
          error: error instanceof Error ? error.message : 'unknown_error',
        },
      });
      throw new UnauthorizedException('Unable to validate authenticated user');
    }

    return true;
  }

  private extractBearerToken(
    request: RequestWithAuthenticatedUser,
  ): string | null {
    const authorizationHeader = request.header('authorization');

    if (!authorizationHeader) {
      return null;
    }

    const [scheme, token] = authorizationHeader.split(' ');

    if (scheme !== 'Bearer' || !token?.trim()) {
      return null;
    }

    return token.trim();
  }
}
