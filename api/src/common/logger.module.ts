import { randomUUID } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';
import { LoggerModule } from 'nestjs-pino';
import pretty from 'pino-pretty';
import { ConfigModule, ConfigService } from '@nestjs/config';

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.refreshToken',
  'res.headers["set-cookie"]',
];

/**
 * pino-http configuration.
 *
 * `genReqId` produces the UUID that becomes both `req.id` and the `X-Request-Id`
 * response header, so log lines and error bodies always carry the same id.
 */
export const pinoHttpOptions = {
  genReqId: (req: IncomingMessage, res: ServerResponse): string => {
    const existing = req.headers['x-request-id'];
    const requestId =
      typeof existing === 'string' && existing.length > 0
        ? existing
        : randomUUID();
    res.setHeader('X-Request-Id', requestId);
    return requestId;
  },
  redact: {
    paths: REDACTED_PATHS,
    censor: '[REDACTED]',
  },
  autoLogging: {
    ignore: (req: IncomingMessage): boolean => {
      const url = req.url ?? '';
      return /^\/(?:api\/)?health(?:\/|$)/.test(url.split('?')[0] ?? '');
    },
  },
};

/**
 * In development the JSON log lines are piped through pino-pretty.
 *
 * pino-pretty is used as an in-process STREAM rather than pino's `transport`
 * option: the transport spawns a worker thread, and a second pino instance
 * built on the same transport options crashes the process on this Node version.
 * A plain stream keeps everything in-process and has no worker to clean up.
 */
function buildPinoHttpOptions(): Record<string, unknown> {
  if (process.env.NODE_ENV !== 'development') {
    return { ...pinoHttpOptions };
  }

  return {
    ...pinoHttpOptions,
    stream: pretty({
      singleLine: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname,req,res',
      messageFormat: '{req.method} {req.url} {res.statusCode} - {msg}',
    }),
  };
}

export const loggerModule = LoggerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    pinoHttp: {
      ...buildPinoHttpOptions(),
      level: config.get<string>('LOG_LEVEL', 'info'),
    },
  }),
});
