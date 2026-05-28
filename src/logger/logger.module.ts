import { randomUUID } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';
import { Global, Module, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { stdSerializers } from 'pino';
import { SecurityLoggerService } from './security-logger.service';

type RequestWithContext = IncomingMessage & {
  id?: string;
  requestId?: string;
  method?: string;
  url?: string;
};

@Global()
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const prettyPrint = configService.getOrThrow<boolean>('logger.prettyPrint');
        const logLevel = configService.getOrThrow<string>('logger.level');
        const apiPrefix = configService.getOrThrow<string>('app.apiPrefix');

        return {
          forRoutes: [
            {
              path: '*path',
              method: RequestMethod.ALL,
            },
          ],
          pinoHttp: {
            level: logLevel,
            autoLogging: {
              ignore: (request) => request.url === `/${apiPrefix}/health/live`,
            },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
              ],
              remove: true,
            },
            transport: prettyPrint
              ? {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    singleLine: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                  },
                }
              : undefined,
            genReqId: (request, response) => {
              const req = request as RequestWithContext;
              const res = response as ServerResponse;
              const requestIdHeader = req.headers['x-request-id'];
              const requestId =
                req.requestId ??
                (Array.isArray(requestIdHeader)
                  ? requestIdHeader[0]
                  : requestIdHeader) ??
                randomUUID();

              req.requestId = requestId;
              res.setHeader('x-request-id', requestId);
              return requestId;
            },
            customProps: (request) => {
              const req = request as RequestWithContext;

              return {
                requestId: req.requestId ?? req.id,
              };
            },
            serializers: {
              err: stdSerializers.err,
              req: (request) => {
                const req = request as RequestWithContext;

                return {
                  id: req.requestId ?? req.id,
                  method: req.method,
                  url: req.url,
                  remoteAddress: req.socket?.remoteAddress,
                };
              },
              res: (response) => ({
                statusCode: response.statusCode,
              }),
            },
          },
        };
      },
    }),
  ],
  providers: [SecurityLoggerService],
  exports: [PinoLoggerModule, SecurityLoggerService],
})
export class AppLoggerModule {}
