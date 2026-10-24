import { ConfigModuleOptions } from '@nestjs/config';
import {
  conditionalEnvSchema,
  databaseEnvValidationSchema,
  envValidationSchema,
} from './env.validation';

/**
 * Validation runs twice on purpose:
 * 1. base schema  -> shapes, defaults, types
 * 2. conditional -> Twilio vars required only when SMS_PROVIDER=twilio
 *
 * Both messages are joined so a misconfigured .env fails at boot with the exact
 * key names, instead of a cryptic runtime error later.
 */
export const validateEnv = (
  config: Record<string, unknown>,
): Record<string, unknown> => {
  const base = envValidationSchema.validate(config, {
    abortEarly: false,
    allowUnknown: true,
    convert: true,
  });

  if (base.error) {
    throw new Error(
      `Config validation error:\n${base.error.details
        .map((detail) => `  - ${detail.message}`)
        .join('\n')}`,
    );
  }

  const conditional = conditionalEnvSchema.validate(base.value, {
    abortEarly: false,
    allowUnknown: true,
    convert: true,
  });

  if (conditional.error) {
    throw new Error(
      `Config validation error:\n${conditional.error.details
        .map((detail) => `  - ${detail.message}`)
        .join('\n')}`,
    );
  }

  return conditional.value;
};

export const validateDatabaseEnv = (
  config: Record<string, unknown>,
): Record<string, unknown> => {
  const { value, error } = databaseEnvValidationSchema.validate(config, {
    abortEarly: false,
    allowUnknown: true,
    convert: true,
  });

  if (error) {
    throw new Error(
      `Database configuration validation error:\n${error.details
        .map((detail) => `  - ${detail.message}`)
        .join('\n')}`,
    );
  }

  return value;
};

/**
 * `.env.test` takes precedence over `.env` when NODE_ENV=test.
 * ConfigModule merges env files first-wins, so the order below is intentional.
 */
const envFilePaths =
  process.env.NODE_ENV === 'test' ? ['.env.test', '.env'] : ['.env'];

export const configModuleOptions: ConfigModuleOptions = {
  isGlobal: true,
  cache: true,
  envFilePath: envFilePaths,
  validate: validateEnv,
};
