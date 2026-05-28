import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';
import { SYSTEM_QUEUE } from './queue.constants';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          url: configService.getOrThrow<string>('redis.url'),
          lazyConnect: true,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        },
        prefix: configService.getOrThrow<string>('queue.prefix'),
        defaultJobOptions: {
          attempts: 3,
          removeOnComplete: 1000,
          removeOnFail: 5000,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
        },
      }),
    }),
    BullModule.registerQueue({
      name: SYSTEM_QUEUE,
    }),
  ],
  providers: [QueueService],
  exports: [BullModule, QueueService],
})
export class QueueModule {}
