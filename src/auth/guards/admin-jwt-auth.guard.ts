import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { SecurityLoggerService } from '../../logger/security-logger.service'
import { AdminJwtAccessTokenPayload } from '../interfaces/admin-jwt-payload.interface'
import { RequestWithAdminUser } from '../interfaces/admin-authenticated-request.interface'

type AdminIdentitySnapshot = {
  id?: string
  email?: string
  name?: string
  role?: string
  permissions?: string[]
}

@Injectable()
export class AdminJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly securityLogger: SecurityLoggerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAdminUser>()
    const token = this.extractBearerToken(request)

    if (!token) {
      this.securityLogger.log('auth.admin_catalog_request', 'failure', {
        ipAddress: request.ip,
        userAgent: request.header('user-agent'),
        reason: 'missing_bearer_token',
      })
      throw new UnauthorizedException('Missing admin bearer token')
    }

    let payload: AdminJwtAccessTokenPayload

    try {
      payload = await this.jwtService.verifyAsync<AdminJwtAccessTokenPayload>(
        token,
        {
          secret: this.configService.getOrThrow<string>('auth.accessTokenSecret'),
        },
      )
    } catch (error) {
      this.securityLogger.log('auth.admin_catalog_request', 'failure', {
        ipAddress: request.ip,
        userAgent: request.header('user-agent'),
        reason: 'invalid_bearer_token',
        metadata: {
          error: error instanceof Error ? error.message : 'unknown_error',
        },
      })
      throw new UnauthorizedException('Invalid admin access token')
    }

    if (
      payload.typ !== 'admin_access' ||
      payload.act !== 'admin' ||
      !payload.sub?.trim() ||
      !payload.sid?.trim()
    ) {
      this.securityLogger.log('auth.admin_catalog_request', 'failure', {
        ipAddress: request.ip,
        userAgent: request.header('user-agent'),
        reason: 'invalid_admin_access_token_payload',
      })
      throw new UnauthorizedException('Invalid admin access token')
    }

    const adminSnapshot = await this.resolveAdminSnapshot(token, payload, request)

    request.adminUser = {
      adminUserId: adminSnapshot.id ?? payload.sub,
      sessionId: payload.sid,
      email: adminSnapshot.email ?? payload.email,
      name: adminSnapshot.name ?? payload.name,
      role: adminSnapshot.role ?? payload.role,
      permissions: Array.isArray(adminSnapshot.permissions)
        ? adminSnapshot.permissions
        : Array.isArray(payload.permissions)
          ? payload.permissions
          : [],
      tokenType: 'admin_access',
    }

    this.securityLogger.log('auth.admin_catalog_request', 'success', {
      actorUserId: payload.sub,
      actorSessionId: payload.sid,
      ipAddress: request.ip,
      userAgent: request.header('user-agent'),
    })

    return true
  }

  private async resolveAdminSnapshot(
    token: string,
    payload: AdminJwtAccessTokenPayload,
    request: RequestWithAdminUser,
  ): Promise<AdminIdentitySnapshot> {
    const baseUrl = this.configService.get<string | undefined>('identity.baseUrl')

    if (!baseUrl) {
      const appEnv = this.configService.get<string | undefined>('app.env')

      if (appEnv === 'production') {
        this.securityLogger.log('auth.admin_catalog_request', 'failure', {
          actorUserId: payload.sub,
          actorSessionId: payload.sid,
          ipAddress: request.ip,
          userAgent: request.header('user-agent'),
          reason: 'identity_base_url_required',
        })
        throw new UnauthorizedException('Admin identity validation is unavailable')
      }

      return {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        role: payload.role,
        permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
      }
    }

    const timeoutMs =
      this.configService.get<number | undefined>('identity.signalsTimeoutMs') ??
      3000
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(
        `${baseUrl.replace(/\/$/, '')}/api/admin/auth/me`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        },
      )

      if (!response.ok) {
        throw new Error(`Identity returned HTTP ${response.status}`)
      }

      const snapshot = (await response.json()) as AdminIdentitySnapshot

      if (snapshot.id !== payload.sub) {
        throw new Error('Admin identity mismatch')
      }

      return snapshot
    } catch (error) {
      this.securityLogger.log('auth.admin_catalog_request', 'failure', {
        actorUserId: payload.sub,
        actorSessionId: payload.sid,
        ipAddress: request.ip,
        userAgent: request.header('user-agent'),
        reason: 'identity_admin_validation_failed',
        metadata: {
          error: error instanceof Error ? error.message : 'unknown_error',
        },
      })
      throw new UnauthorizedException('Admin identity validation failed')
    } finally {
      clearTimeout(timeout)
    }
  }

  private extractBearerToken(request: RequestWithAdminUser): string | null {
    const authorizationHeader = request.header('authorization')

    if (!authorizationHeader) {
      return null
    }

    const [scheme, token] = authorizationHeader.split(' ')

    if (scheme !== 'Bearer' || !token?.trim()) {
      return null
    }

    return token.trim()
  }
}
