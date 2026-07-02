import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatDateForTimeZone, isValidIanaTimeZone } from '../common/utils/time-zone.util';
import { QueueService } from '../queue/queue.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly queueService: QueueService,
    private readonly redisService: RedisService,
  ) {}

  getLiveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness() {
    const now = new Date();
    const timeZone = this.configService.getOrThrow<string>('app.timeZone');
    const [queue, redisCache] = await Promise.all([
      this.queueService.ping(),
      this.redisService.getHealthSummary().catch((error) => ({
        status: 'degraded',
        role: 'cache',
        message: error instanceof Error ? error.message : 'Unknown Redis error',
      })),
    ]);

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
      redisCache,
      queue,
    };
  }
}
