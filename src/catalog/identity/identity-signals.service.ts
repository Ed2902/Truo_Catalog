import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AuthenticatedRequestUser } from '../../auth/interfaces/authenticated-request.interface';
import { CatalogActor } from '../interfaces/catalog-actor.interface';
import { IdentityUserSignals } from '../interfaces/identity-signals.interface';

@Injectable()
export class IdentitySignalsService {
  private readonly logger = new Logger(IdentitySignalsService.name);

  constructor(private readonly configService: ConfigService) {}

  async getSignalsForUser(
    userId: string,
    actor?: CatalogActor,
    request?: Request,
  ): Promise<IdentityUserSignals> {
    if (actor && actor.userId === userId) {
      return {
        userId,
        isPremium: actor.isPremium,
        source: 'request',
      };
    }

    const cachedSignals = this.tryReadSignalsFromHeaderCache(userId, request);

    if (cachedSignals) {
      return cachedSignals;
    }

    const baseUrl = this.configService.get<string | undefined>('identity.baseUrl');

    if (baseUrl) {
      return this.fetchSignalsFromIdentity(baseUrl, userId);
    }

    this.logger.warn(
      `Identity signals for user ${userId} were resolved with fallback non-premium state`,
    );

    return {
      userId,
      isPremium: false,
      source: 'fallback',
    };
  }

  async resolveAuthenticatedActor(
    authUser: AuthenticatedRequestUser,
    request: Request,
    accessToken: string,
  ): Promise<CatalogActor> {
    const baseUrl = this.configService.get<string | undefined>('identity.baseUrl');

    if (baseUrl) {
      const snapshot = await this.fetchCurrentUserSnapshot(baseUrl, accessToken);

      if (snapshot.userId !== authUser.userId) {
        throw new Error('Authenticated user mismatch between Catalog and Identity');
      }

      return {
        userId: authUser.userId,
        isPremium: snapshot.isPremium,
      };
    }

    const developmentHeaderSignals = this.tryReadSignalsFromHeaderCache(
      authUser.userId,
      request,
    );

    if (developmentHeaderSignals) {
      return {
        userId: authUser.userId,
        isPremium: developmentHeaderSignals.isPremium,
      };
    }

    this.logger.warn(
      `Identity base URL is not configured. Catalog auth is using verified JWT only for user ${authUser.userId}`,
    );

    return {
      userId: authUser.userId,
      isPremium: false,
    };
  }

  private tryReadSignalsFromHeaderCache(
    userId: string,
    request?: Request,
  ): IdentityUserSignals | null {
    const appEnv = this.configService.get<string | undefined>('app.env');

    if (appEnv === 'production') {
      return null;
    }

    const rawHeader = request?.header('x-identity-signals-cache');

    if (!rawHeader) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawHeader) as Record<
        string,
        { isPremium?: boolean }
      >;
      const cachedUser = parsed[userId];

      if (!cachedUser || typeof cachedUser.isPremium !== 'boolean') {
        return null;
      }

      return {
        userId,
        isPremium: cachedUser.isPremium,
        source: 'header-cache',
      };
    } catch (error) {
      this.logger.warn(
        {
          err: error,
        },
        'Ignoring malformed x-identity-signals-cache header',
      );
      return null;
    }
  }

  private async fetchSignalsFromIdentity(
    baseUrl: string,
    userId: string,
  ): Promise<IdentityUserSignals> {
    const timeoutMs =
      this.configService.get<number | undefined>('identity.signalsTimeoutMs') ??
      3000;
    const internalToken = this.configService.get<string | undefined>(
      'identity.internalToken',
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(
        `${baseUrl.replace(/\/$/, '')}/api/internal/users/${userId}/signals`,
        {
          headers: {
            ...(internalToken ? { 'x-internal-token': internalToken } : {}),
          },
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new Error(`Identity returned HTTP ${response.status}`);
      }

      const payload = (await response.json()) as { isPremium?: boolean };

      return {
        userId,
        isPremium: Boolean(payload.isPremium),
        source: 'identity-service',
      };
    } catch (error) {
      this.logger.warn(
        {
          err: error,
          userId,
        },
        'Falling back to non-premium state after identity lookup failure',
      );

      return {
        userId,
        isPremium: false,
        source: 'fallback',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchCurrentUserSnapshot(baseUrl: string, accessToken: string) {
    const timeoutMs =
      this.configService.get<number | undefined>('identity.signalsTimeoutMs') ??
      3000;
    const internalToken = this.configService.get<string | undefined>(
      'identity.internalToken',
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/users/me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(internalToken ? { 'x-internal-token': internalToken } : {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Identity returned HTTP ${response.status}`);
      }

      const payload = (await response.json()) as {
        user?: { id?: string };
        premium?: { isPremium?: boolean };
      };

      if (!payload.user?.id) {
        throw new Error('Identity response is missing user.id');
      }

      return {
        userId: payload.user.id,
        isPremium: Boolean(payload.premium?.isPremium),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
