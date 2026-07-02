import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  protected async getTracker(request: Record<string, any>): Promise<string> {
    const authenticatedUserId =
      request.user?.userId ??
      request.user?.id ??
      request.catalogActor?.userId ??
      null;

    if (typeof authenticatedUserId === 'string' && authenticatedUserId.trim()) {
      return `user:${authenticatedUserId}`;
    }

    const bearerToken = this.extractBearerToken(request);
    const clientIp = this.resolveClientIp(request);

    if (bearerToken) {
      return `${clientIp}:auth:${createHash('sha256')
        .update(bearerToken)
        .digest('hex')
        .slice(0, 16)}`;
    }

    return clientIp;
  }

  private resolveClientIp(request: Record<string, any>): string {
    const forwardedFor = request.headers?.['x-forwarded-for'];

    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
      return forwardedFor.split(',')[0].trim();
    }

    if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
      return forwardedFor[0];
    }

    return (
      request.ip ??
      request.ips?.[0] ??
      request.socket?.remoteAddress ??
      'unknown'
    );
  }

  private extractBearerToken(request: Record<string, any>): string | null {
    const authorizationHeader = request.headers?.authorization;

    if (typeof authorizationHeader !== 'string') {
      return null;
    }

    const [scheme, token] = authorizationHeader.split(' ');

    if (scheme !== 'Bearer' || !token?.trim()) {
      return null;
    }

    return token.trim();
  }
}
