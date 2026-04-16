import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @SkipThrottle({
    default: true,
  })
  getLiveness() {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  @SkipThrottle({
    default: true,
  })
  getReadiness() {
    return this.healthService.getReadiness();
  }
}
