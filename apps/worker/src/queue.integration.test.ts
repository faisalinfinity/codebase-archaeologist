import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Queue, QueueEvents, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { expect, it } from 'vitest';
import { createDatabase, users } from '@archaeologist/db';
import { DrizzleRepositoryStore, INDEX_JOB_NAME, type IndexJobPayload } from '@archaeologist/api';
import { eq } from 'drizzle-orm';
import { processLocalFixture } from './process-index-job';

const run = promisify(execFile);
const testWithServices = process.env.TEST_DATABASE_URL && process.env.TEST_REDIS_URL ? it : it.skip;

testWithServices(
  'processes a real Redis job into a ready Postgres source snapshot',
  async () => {
    const db = createDatabase(process.env.TEST_DATABASE_URL!);
    const store = new DrizzleRepositoryStore(db);
    const userId = randomUUID();
    const source = await mkdtemp(path.join(os.tmpdir(), 'archaeologist-queue-'));
    const name = `verify-${randomUUID()}`;
    const connection = new IORedis(process.env.TEST_REDIS_URL!, { maxRetriesPerRequest: null });
    const queue = new Queue<IndexJobPayload>(name, { connection });
    const events = new QueueEvents(name, { connection });
    const worker = new Worker<IndexJobPayload>(
      name,
      (job) => processLocalFixture(job.data, store, source),
      { connection },
    );
    try {
      await run('git', ['init', '-b', 'main'], { cwd: source });
      await run('git', ['config', 'user.name', 'Fixture'], { cwd: source });
      await run('git', ['config', 'user.email', 'fixture@localhost'], { cwd: source });
      await writeFile(
        path.join(source, 'service.py'),
        'def authenticate(token):\n    return token == "valid"\n',
      );
      await run('git', ['add', '.'], { cwd: source });
      await run('git', ['commit', '-m', 'add authentication'], { cwd: source });
      await store.upsertUser({ id: userId, email: 'queue-test@localhost' });
      const inserted = await store.insertRepository({
        ownerUserId: userId,
        githubOwner: 'fixture',
        githubRepo: randomUUID(),
        githubUrl: 'https://github.com/fixture/queue',
        defaultBranch: 'main',
      });
      await events.waitUntilReady();
      const job = await queue.add(INDEX_JOB_NAME, {
        repositoryId: inserted.repository.id,
        jobId: inserted.job.id,
      });
      await job.waitUntilFinished(events, 15_000);
      expect((await store.getJob(inserted.job.id))?.status).toBe('READY');
      const snapshot = await store.getLatestReadySnapshot(inserted.repository.id);
      expect(snapshot).not.toBeNull();
      expect((await store.getFile(snapshot!.id, 'service.py'))?.symbols[0]?.name).toBe(
        'authenticate',
      );
      expect((await store.listCommits(inserted.repository.id, 10))[0]?.message).toBe(
        'add authentication',
      );
    } finally {
      await worker.close();
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await connection.quit();
      await db.delete(users).where(eq(users.id, userId));
      await db.$client.end();
      await rm(source, { recursive: true, force: true });
    }
  },
  30_000,
);
