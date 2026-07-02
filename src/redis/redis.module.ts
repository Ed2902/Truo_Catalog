import { Global, Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { REDIS } from './redis.constants'
import { RedisService } from './redis.service'

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const client = new Redis(
          configService.getOrThrow<string>('redis.cacheUrl'),
          {
            lazyConnect: true,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
          }
        )

        client.on('error', () => {
          // Bootstrap handles the connection failure explicitly in RedisService.
        })

        return client
      },
    },
    RedisService,
  ],
  exports: [REDIS, RedisService],
})
export class RedisModule {}
