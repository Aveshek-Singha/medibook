import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createApp } from '../src/bootstrap';

/**
 * Shared e2e app factory.
 *
 * It reuses `createApp` — the same function `main.ts` uses — so the e2e suite
 * exercises the real global prefix, versioning, validation pipe, exception
 * filter and CORS setup instead of a simplified test-only app.
 */
export async function createTestApp(
  moduleRef?: Parameters<typeof Test.createTestingModule>[0],
): Promise<INestApplication> {
  const testingModule = await Test.createTestingModule({
    imports: moduleRef?.imports ?? [],
    controllers: moduleRef?.controllers,
    providers: moduleRef?.providers,
  }).compile();

  const app = testingModule.createNestApplication();
  await app.init();
  return app;
}

/**
 * Boots the real application (same wiring as production) for integration tests.
 * Bind one ephemeral loopback port so Supertest can reuse the same HTTP server
 * without repeatedly attaching temporary listeners to an unbound server.
 */
export async function createE2eApp(): Promise<INestApplication> {
  const app = await createApp({ enableCors: true });
  await app.init();
  await app.listen(0, '127.0.0.1');
  return app;
}
