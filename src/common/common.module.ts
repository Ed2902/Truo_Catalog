import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { NotificationsApiService } from './notifications-api.service';
import { ThrottlerBehindProxyGuard } from './guards/throttler-behind-proxy.guard';
import { ResponseTimeInterceptor } from './interceptors/response-time.interceptor';
import { HomePerformanceService } from './observability/home-performance.service';
import { CircuitBreakerService } from './resilience/circuit-breaker.service';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: configService.getOrThrow<number>('rateLimit.ttl'),
            limit: configService.getOrThrow<number>('rateLimit.limit'),
          },
          {
            name: 'sensitive',
            ttl: configService.getOrThrow<number>('rateLimit.sensitiveTtl'),
            limit: configService.getOrThrow<number>('rateLimit.sensitiveLimit'),
          },
          {
            name: 'home',
            ttl: configService.getOrThrow<number>('rateLimit.homeTtl'),
            limit: configService.getOrThrow<number>('rateLimit.homeLimit'),
          },
          {
            name: 'detail',
            ttl: configService.getOrThrow<number>('rateLimit.detailTtl'),
            limit: configService.getOrThrow<number>('rateLimit.detailLimit'),
          },
          {
            name: 'mediaUpload',
            ttl: configService.getOrThrow<number>('rateLimit.mediaUploadTtl'),
            limit: configService.getOrThrow<number>(
              'rateLimit.mediaUploadLimit',
            ),
          },
        ],
      }),
    }),
  ],
  providers: [
    GlobalExceptionFilter,
    CircuitBreakerService,
    HomePerformanceService,
    ResponseTimeInterceptor,
    NotificationsApiService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerBehindProxyGuard,
    },
  ],
  exports: [
    GlobalExceptionFilter,
    CircuitBreakerService,
    HomePerformanceService,
    ResponseTimeInterceptor,
    ThrottlerModule,
    NotificationsApiService,
  ],
})
export class CommonModule {}
