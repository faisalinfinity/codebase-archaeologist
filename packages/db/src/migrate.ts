import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export async function applyMigrations(databaseUrl: string): Promise<string[]> {
  const sql = postgres(databaseUrl, { max: 1 });
  const applied: string[] = [];

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    for (const file of files) {
      const already = await sql<{ id: string }[]>`
        SELECT id FROM schema_migrations WHERE id = ${file}
      `;
      if (already.length > 0) {
        continue;
      }

      const content = await readFile(path.join(migrationsDir, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`INSERT INTO schema_migrations (id) VALUES (${file})`;
      });
      applied.push(file);
    }
  } finally {
    await sql.end();
  }

  return applied;
}

async function main(): Promise<void> {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL (or DIRECT_DATABASE_URL) is required to migrate.');
  }

  const applied = await applyMigrations(url);
  if (applied.length === 0) {
    console.log('No pending migrations.');
    return;
  }
  for (const file of applied) {
    console.log(`applied ${file}`);
  }
}

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
