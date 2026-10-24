import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

export interface AppSetupOptions {
  /** e2e keeps the server un-listened so supertest can drive it in-process. */
  enableCors?: boolean;
}

/**
 * Single bootstrap used by BOTH `main.ts` and the e2e suite.
 *
 * Keeping one factory is deliberate: if e2e built the app differently, the
 * global prefix, version prefix, validation pipe, exception filter and CORS
 * would differ from production and the tests would prove nothing.
 */
export async function createApp(
  options: AppSetupOptions = {},
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
    // pino is the single logger; Nest's built-in logger would duplicate every line.
    logger: false,
  });

  const configService = app.get(ConfigService);
  const apiPrefix = configService.get<string>('API_PREFIX', 'api');
  app
    .getHttpAdapter()
    .getInstance()
    .set(
      'trust proxy',
      configService.get<boolean | number>('TRUST_PROXY', false),
    );

  app.setGlobalPrefix(apiPrefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          // Swagger UI assets are served from this origin, so no CDN is needed.
          upgradeInsecureRequests:
            process.env.NODE_ENV === 'production' ? [] : null,
        },
      },
    }),
  );

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (options.enableCors !== false) {
    const webUrl = configService.get<string>(
      'WEB_URL',
      'http://localhost:3000',
    );
    app.enableCors({
      origin: webUrl.split(',').map((origin) => origin.trim()),
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
    });
  }

  if (configService.get<boolean>('SWAGGER_ENABLED', true)) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('MediBook API')
      .setDescription(
        'Appointment booking API with JWT auth, RBAC, transactional booking and queued SMS reminders.',
      )
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'bearer',
      )
      .addTag('auth')
      .addTag('doctors')
      .addTag('patients')
      .addTag('doctor')
      .addTag('admin')
      .addTag('health')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: false },
    });
  }

  app.enableShutdownHooks();

  return app;
}
