import { randomUUID } from 'node:crypto';

import * as schema from '@archaeologist/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { expect, it } from 'vitest';

import { DrizzleRepositoryStore } from './drizzle-repository-store';

const testWithDatabase = process.env.TEST_DATABASE_URL ? it : it.skip;

testWithDatabase('Postgres persists bounded history and import edges', async () => {
  const client = postgres(process.env.TEST_DATABASE_URL ?? '', { max: 1 });
  const db = drizzle(client, { schema });
  const store = new DrizzleRepositoryStore(db);
  const userId = randomUUID();
  try {
    await store.upsertUser({ id: userId, email: 'history-test@localhost' });
    const inserted = await store.insertRepository({
      ownerUserId: userId,
      githubOwner: 'integration',
      githubRepo: `history-${randomUUID()}`,
      githubUrl: 'https://github.com/integration/history',
    });
    const repositoryId = inserted.repository.id;
    const snapshot = await store.upsertSnapshot({
      repositoryId,
      commitSha: randomUUID().replaceAll('-', ''),
      branch: 'main',
      status: 'READY',
      completedAt: new Date(),
    });
    const file = (path: string, imports: string[]) => ({
      repositoryId,
      snapshotId: snapshot.id,
      path,
      language: 'typescript',
      sizeBytes: 10,
      sha: 'sha',
      content: 'export {}',
      isBinary: false,
      isGenerated: false,
      symbols: [
        {
          name: path === 'src/a.ts' ? 'run' : 'work',
          symbolType: 'function',
          startLine: 1,
          endLine: 1,
          signature: 'export function',
        },
      ],
      references:
        path === 'src/a.ts'
          ? [
              {
                sourceName: 'run',
                sourceStartLine: 1,
                targetName: 'work',
                targetModule: './b',
                line: 1,
                relationshipType: 'calls' as const,
              },
            ]
          : [],
      chunks: [],
      imports,
    });
    await store.replaceSnapshotFiles(snapshot.id, [
      file('src/a.ts', ['./b']),
      file('src/b.ts', []),
    ]);
    await store.replaceCommitHistory(repositoryId, [
      {
        sha: 'a'.repeat(40),
        parentSha: null,
        authorName: 'Test',
        committedAt: new Date(),
        message: 'add b module',
        files: [{ path: 'src/b.ts', changeType: 'A' }],
      },
    ]);
    await store.replacePullRequests(repositoryId, [
      {
        number: 1,
        title: 'Add module',
        files: [{ path: 'src/b.ts', changeType: 'added' }],
        filesComplete: true,
        relatedIssues: [2],
        body: 'Context',
        author: 'tester',
        state: 'closed',
        createdAt: new Date(),
        mergedAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    await store.replaceIssues(repositoryId, [
      {
        number: 2,
        title: 'Module issue',
        filePaths: ['src/b.ts'],
        body: null,
        author: 'tester',
        state: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    expect(await store.listImportEdges(snapshot.id)).toEqual([
      { sourcePath: 'src/a.ts', targetPath: 'src/b.ts' },
    ]);
    expect((await store.listCommits(repositoryId, 10))[0]).toMatchObject({
      message: 'add b module',
      files: [{ path: 'src/b.ts', changeType: 'A' }],
    });
    expect((await store.listPullRequests(repositoryId, 10))[0]?.number).toBe(1);
    expect((await store.listIssues(repositoryId, 10))[0]?.number).toBe(2);
    expect((await store.listPullRequests(repositoryId, 10))[0]).toMatchObject({
      files: [{ path: 'src/b.ts', changeType: 'added' }],
      filesComplete: true,
      relatedIssues: [2],
    });
    expect((await store.listIssues(repositoryId, 10))[0]?.filePaths).toEqual(['src/b.ts']);
    expect(await store.listSymbolEdges(snapshot.id)).toEqual([
      {
        sourcePath: 'src/a.ts',
        sourceName: 'run',
        sourceLine: 1,
        targetPath: 'src/b.ts',
        targetName: 'work',
        targetLine: 1,
        relationshipType: 'calls',
      },
    ]);
    const jobs = await Promise.all(
      Array.from({ length: 5 }, () => store.createIndexJob(repositoryId)),
    );
    expect(new Set(jobs.map((job) => job.id)).size).toBe(1);
  } finally {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await client.end();
  }
});
