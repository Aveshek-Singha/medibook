import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { createApp } from './bootstrap';

async function bootstrap(): Promise<void> {
  const app = await createApp();

  const configService = app.get(ConfigService);
  const logger = app.get(Logger);
  const port = configService.get<number>('PORT', 3000);
  const apiPrefix = configService.get<string>('API_PREFIX', 'api');

  await app.listen(port, '0.0.0.0');

  logger.log(
    `MediBook API listening on http://localhost:${port}/${apiPrefix}/v1`,
  );
  if (configService.get<boolean>('SWAGGER_ENABLED', true)) {
    logger.log(`Swagger UI: http://localhost:${port}/${apiPrefix}/docs`);
  }
}

bootstrap().catch((error: unknown) => {
  // Without this the process exits silently and the real cause is lost.
  console.error('Failed to start MediBook API:', error);
  process.exitCode = 1;
});
