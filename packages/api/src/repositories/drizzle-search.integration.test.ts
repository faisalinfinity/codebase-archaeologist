import { randomUUID } from 'node:crypto';

import * as schema from '@archaeologist/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { it, expect } from 'vitest';

import { DrizzleRepositoryStore } from './drizzle-repository-store';

const testWithDatabase = process.env.TEST_DATABASE_URL ? it : it.skip;

testWithDatabase('Postgres stores and retrieves keyword and vector evidence', async () => {
  const client = postgres(process.env.TEST_DATABASE_URL ?? '', { max: 1 });
  const db = drizzle(client, { schema });
  const store = new DrizzleRepositoryStore(db);
  const userId = randomUUID();
  try {
    await store.upsertUser({ id: userId, email: 'retrieval-test@localhost' });
    const inserted = await store.insertRepository({
      ownerUserId: userId,
      githubOwner: 'integration',
      githubRepo: `search-${randomUUID()}`,
      githubUrl: 'https://github.com/integration/search',
    });
    const snapshot = await store.upsertSnapshot({
      repositoryId: inserted.repository.id,
      commitSha: randomUUID().replaceAll('-', ''),
      branch: 'main',
      status: 'READY',
      completedAt: new Date(),
    });
    await store.replaceSnapshotFiles(snapshot.id, [
      {
        repositoryId: inserted.repository.id,
        snapshotId: snapshot.id,
        path: 'src/auth.ts',
        language: 'typescript',
        sizeBytes: 34,
        sha: 'fixture',
        content: 'export function authenticate() {}',
        isBinary: false,
        isGenerated: false,
        symbols: [],
        imports: [],
        chunks: [{ content: 'export function authenticate() {}', startLine: 1, endLine: 1 }],
      },
    ]);

    expect(await store.countChunks(snapshot.id)).toBe(1);
    const lexical = await store.searchLexical(snapshot.id, 'authenticate', 5);
    expect(lexical[0]?.filePath).toBe('src/auth.ts');
    const chunk = (await store.getChunksForEmbedding(snapshot.id, null, 1))[0];
    if (!chunk) throw new Error('Indexed chunk missing.');
    const vector = Array<number>(1536).fill(0);
    vector[0] = 1;
    await store.updateChunkEmbeddings(snapshot.id, 'integration-model', [
      { id: chunk.id, embedding: vector },
    ]);
    expect(await store.hasEmbeddings(snapshot.id, 'integration-model')).toBe(true);
    const semantic = await store.searchSemantic(snapshot.id, 'integration-model', vector, 5);
    expect(semantic[0]?.filePath).toBe('src/auth.ts');
    expect(semantic[0]?.score).toBeCloseTo(1);
  } finally {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await client.end();
  }
});
