import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatDateForTimeZone, isValidIanaTimeZone } from '../common/utils/time-zone.util';

@Injectable()
export class HealthService {
  constructor(private readonly configService: ConfigService) {}

  getLiveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  getReadiness() {
    const now = new Date();
    const timeZone = this.configService.getOrThrow<string>('app.timeZone');

    return {
      status: 'ok',
      timestamp: now.toISOString(),
      app: this.configService.getOrThrow<string>('app.name'),
      env: this.configService.getOrThrow<string>('app.env'),
      uptimeSeconds: Math.round(process.uptime()),
      timeZone,
      localTime: isValidIanaTimeZone(timeZone)
        ? formatDateForTimeZone(now, timeZone)
        : now.toISOString(),
    };
  }
}
