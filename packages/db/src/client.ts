import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(url: string) {
  const defaultMax = process.env.VERCEL ? 1 : 3;
  const configuredMax = Number(process.env.DATABASE_POOL_MAX ?? defaultMax);
  // The driver supports max_pipeline at runtime; its published types omit it.
  const connectionOptions = {
    max:
      Number.isSafeInteger(configuredMax) && configuredMax > 0
        ? Math.min(configuredMax, 20)
        : defaultMax,
    prepare: false,
    max_pipeline: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  };
  const client = postgres(url, connectionOptions);
  return drizzle(client, { schema });
}

let cached: Database | null = null;

export function getDatabase(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set.');
  }
  if (!cached) {
    cached = createDatabase(url);
  }
  return cached;
}
