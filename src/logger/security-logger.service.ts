import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

export type SecurityLogOutcome = 'success' | 'failure' | 'denied' | 'error';

type SecurityLogPayload = {
  actorUserId?: string;
  actorSessionId?: string;
  targetUserId?: string;
  email?: string;
  ipAddress?: string;
  userAgent?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class SecurityLoggerService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(SecurityLoggerService.name);
  }

  log(event: string, outcome: SecurityLogOutcome, payload: SecurityLogPayload = {}) {
    const structuredPayload = {
      template: 'security.event.v1',
      category: 'catalog',
      event,
      outcome,
      ...payload,
    };

    if (outcome === 'error') {
      this.logger.error(structuredPayload, `security.${event}.${outcome}`);
      return;
    }

    if (outcome === 'failure' || outcome === 'denied') {
      this.logger.warn(structuredPayload, `security.${event}.${outcome}`);
      return;
    }

    this.logger.info(structuredPayload, `security.${event}.${outcome}`);
  }
}
