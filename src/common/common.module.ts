import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { NotificationsApiService } from './notifications-api.service';
import { ThrottlerBehindProxyGuard } from './guards/throttler-behind-proxy.guard';
import { ResponseTimeInterceptor } from './interceptors/response-time.interceptor';

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
        ],
      }),
    }),
  ],
  providers: [
    GlobalExceptionFilter,
    ResponseTimeInterceptor,
    NotificationsApiService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerBehindProxyGuard,
    },
  ],
  exports: [
    GlobalExceptionFilter,
    ResponseTimeInterceptor,
    ThrottlerModule,
    NotificationsApiService,
  ],
})
export class CommonModule {}
