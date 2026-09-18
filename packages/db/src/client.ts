import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(url: string) {
  const client = postgres(url, { max: 10 });
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
