import { ValueTransformer } from 'typeorm';

/**
 * MySQL `DECIMAL` comes back from mysql2 as a string, because a decimal can
 * exceed the safe integer range. TypeORM keeps it as a string by default.
 *
 * For money amounts this project works with, converting to `number` is safe
 * and far more convenient than juggling strings in every service and DTO.
 */
export const decimalTransformer: ValueTransformer = {
  to: (value?: number | null): number | null => value ?? null,
  from: (value?: string | null): number | null =>
    value === null || value === undefined ? null : Number(value),
};
