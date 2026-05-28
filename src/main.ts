import 'dotenv/config';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseTimeInterceptor } from './common/interceptors/response-time.interceptor';

function registerProcessErrorHandlers(context: string) {
  const processWithFlag = process as NodeJS.Process & {
    __truoProcessHandlersRegistered?: boolean;
  };

  if (processWithFlag.__truoProcessHandlersRegistered) {
    return;
  }

  processWithFlag.__truoProcessHandlersRegistered = true;

  process.on('unhandledRejection', (reason) => {
    console.error(`[${context}] Unhandled promise rejection`, reason);
  });

  process.on('uncaughtException', (error) => {
    console.error(`[${context}] Uncaught exception`, error);
  });
}

async function bootstrap() {
  registerProcessErrorHandlers('catalog-api');

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    abortOnError: false,
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
    .set(
      'trust proxy',
      configService.getOrThrow<boolean | number | string>('app.trustProxy'),
    );

  app.enableCors({
    origin: configService.getOrThrow<Array<string | RegExp> | boolean>(
      'cors.origin',
    ),
    credentials: configService.getOrThrow<boolean>('cors.credentials'),
    methods: configService.getOrThrow<string[]>('cors.methods'),
    allowedHeaders: configService.getOrThrow<string[]>('cors.allowedHeaders'),
    exposedHeaders: configService.getOrThrow<string[]>('cors.exposedHeaders'),
  });

  await app.listen(configService.getOrThrow<number>('app.port'));
}

void bootstrap().catch((error) => {
  console.error('[catalog-api] Bootstrap failed', error);
});
