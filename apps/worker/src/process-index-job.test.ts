import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { InMemoryRepositoryStore } from '@archaeologist/api';
import { IngestionError } from '@archaeologist/ingestion';
import { describe, expect, it } from 'vitest';

import { processIndexJob, processLocalFixture } from './process-index-job';

const execFileAsync = promisify(execFile);

async function initLocalGitRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'archaeologist-worker-src-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await mkdir(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(path.join(dir, 'README.md'), '# worker fixture\n');
  await writeFile(path.join(dir, 'src', 'app.ts'), 'export function run() { return 1; }\n');
  await writeFile(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'module.exports=1\n');
  await execFileAsync('git', ['add', '.'], { cwd: dir });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('processIndexJob', () => {
  it('creates a snapshot and indexed files from a local public-repo fixture', async () => {
    const source = await initLocalGitRepo();
    const store = new InMemoryRepositoryStore();
    const inserted = await store.insertRepository({
      ownerUserId: '11111111-1111-1111-1111-111111111111',
      githubOwner: 'octocat',
      githubRepo: 'Hello-World',
      githubUrl: 'https://github.com/octocat/Hello-World',
      defaultBranch: 'main',
    });

    await processLocalFixture(
      { repositoryId: inserted.repository.id, jobId: inserted.job.id },
      store,
      source,
    );

    const repo = await store.getById(inserted.repository.id);
    const job = await store.getJob(inserted.job.id);
    const snapshot = job?.snapshotId ? await store.getSnapshot(job.snapshotId) : null;
    expect(repo?.status).toBe('READY');
    expect(job?.status).toBe('READY');
    expect(job?.stage).toBe('READY');
    expect(snapshot?.commitSha).toMatch(/^[0-9a-f]{7,40}$/);
    expect(snapshot?.status).toBe('READY');
    const files = store.files.get(snapshot?.id ?? '') ?? [];
    const paths = files.map((file) => file.path).sort();
    expect(paths).toEqual(['README.md', 'src/app.ts']);
    expect(job?.progress?.filesIndexed).toBe(2);
  });

  it('marks the job FAILED with INDEX_TIMEOUT and does not leave status ambiguous', async () => {
    const store = new InMemoryRepositoryStore();
    const inserted = await store.insertRepository({
      ownerUserId: '11111111-1111-1111-1111-111111111111',
      githubOwner: 'octocat',
      githubRepo: 'Hello-World',
      githubUrl: 'https://github.com/octocat/Hello-World',
    });

    await expect(
      processIndexJob(
        { repositoryId: inserted.repository.id, jobId: inserted.job.id },
        {
          store,
          clone: async () => {
            throw new IngestionError(
              'INDEX_TIMEOUT',
              'Cloning the repository timed out after 1ms.',
            );
          },
          scan: async () => {
            throw new Error('scan should not run');
          },
        },
      ),
    ).rejects.toBeInstanceOf(IngestionError);

    const repo = await store.getById(inserted.repository.id);
    const job = await store.getJob(inserted.job.id);
    expect(repo?.status).toBe('FAILED');
    expect(job?.status).toBe('FAILED');
    expect(job?.errorCode).toBe('INDEX_TIMEOUT');
    expect(job?.stage).toBe('CLONING');
  });
});
