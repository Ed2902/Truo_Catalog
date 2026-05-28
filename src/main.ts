import 'dotenv/config';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseTimeInterceptor } from './common/interceptors/response-time.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  const configService = app.get(ConfigService);

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  app.useGlobalFilters(app.get(GlobalExceptionFilter));
  app.useGlobalInterceptors(app.get(ResponseTimeInterceptor));
  app.setGlobalPrefix(configService.getOrThrow<string>('app.apiPrefix'));
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', configService.getOrThrow<boolean>('app.trustProxy'));

  app.enableCors({
    origin: configService.getOrThrow<string[] | boolean>('cors.origin'),
    credentials: configService.getOrThrow<boolean>('cors.credentials'),
    methods: configService.getOrThrow<string[]>('cors.methods'),
    allowedHeaders: configService.getOrThrow<string[]>('cors.allowedHeaders'),
    exposedHeaders: configService.getOrThrow<string[]>('cors.exposedHeaders'),
  });

  await app.listen(configService.getOrThrow<number>('app.port'));
}

void bootstrap();
