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
          url: configService.getOrThrow<string>('redis.queueUrl'),
          lazyConnect: true,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        },
        prefix: configService.getOrThrow<string>('queue.prefix'),
        defaultJobOptions: {
          attempts: configService.getOrThrow<number>('queue.maxRetries'),
          removeOnComplete: configService.getOrThrow<number>(
            'queue.removeOnComplete',
          ),
          removeOnFail: configService.getOrThrow<number>('queue.removeOnFail'),
          backoff: {
            type: 'exponential',
            delay: configService.getOrThrow<number>('queue.backoffMs'),
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
