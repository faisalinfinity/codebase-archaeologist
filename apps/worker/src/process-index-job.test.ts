import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { InMemoryRepositoryStore } from '@archaeologist/api';
import type { EmbeddingProvider } from '@archaeologist/api';
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
    expect(job?.progress?.commitsIndexed).toBe(1);
    expect(store.history.get(inserted.repository.id)?.[0]?.message).toBe('init');
    const sourceFile = await store.getFile(snapshot?.id ?? '', 'src/app.ts');
    expect(sourceFile?.content).toBe('export function run() { return 1; }\n');
    expect(sourceFile?.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'run', symbolType: 'function', startLine: 1 }),
      ]),
    );
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

  it('embeds indexed chunks when a provider is configured', async () => {
    const source = await initLocalGitRepo();
    const store = new InMemoryRepositoryStore();
    const inserted = await store.insertRepository({
      ownerUserId: '11111111-1111-1111-1111-111111111111',
      githubOwner: 'octocat',
      githubRepo: 'Hello-World',
      githubUrl: 'https://github.com/octocat/Hello-World',
      defaultBranch: 'main',
    });
    const provider: EmbeddingProvider = {
      model: 'fake',
      dimensions: 1536,
      async embed(inputs) {
        return inputs.map(() => {
          const vector = Array<number>(1536).fill(0);
          vector[0] = 1;
          return vector;
        });
      },
    };
    await processLocalFixture(
      { repositoryId: inserted.repository.id, jobId: inserted.job.id },
      store,
      source,
      provider,
    );
    const job = await store.getJob(inserted.job.id);
    expect(job?.status).toBe('READY');
    expect(job?.progress?.chunksEmbedded).toBeGreaterThan(0);
    expect(await store.hasEmbeddings(job?.snapshotId ?? '', 'fake')).toBe(true);
  });

  it('keeps keyword search ready when the embedding cost cap is exceeded', async () => {
    const source = await initLocalGitRepo();
    const store = new InMemoryRepositoryStore();
    const inserted = await store.insertRepository({
      ownerUserId: '11111111-1111-1111-1111-111111111111',
      githubOwner: 'octocat',
      githubRepo: 'Hello-World',
      githubUrl: 'https://github.com/octocat/Hello-World',
      defaultBranch: 'main',
    });
    let calls = 0;
    const provider: EmbeddingProvider = {
      model: 'fake',
      dimensions: 1536,
      async embed() {
        calls += 1;
        return [];
      },
    };
    await processLocalFixture(
      { repositoryId: inserted.repository.id, jobId: inserted.job.id },
      store,
      source,
      provider,
      { MAX_EMBED_CHUNKS: '1' },
    );
    const job = await store.getJob(inserted.job.id);
    expect(job?.status).toBe('READY');
    expect(job?.progress?.message).toContain('configured chunk limit');
    expect(calls).toBe(0);
  });

  it('does not expose an incomplete snapshot when embeddings fail', async () => {
    const source = await initLocalGitRepo();
    const store = new InMemoryRepositoryStore();
    const inserted = await store.insertRepository({
      ownerUserId: '11111111-1111-1111-1111-111111111111',
      githubOwner: 'octocat',
      githubRepo: 'Hello-World',
      githubUrl: 'https://github.com/octocat/Hello-World',
      defaultBranch: 'main',
    });
    const provider: EmbeddingProvider = {
      model: 'fake',
      dimensions: 1536,
      async embed() {
        throw new Error('provider unavailable');
      },
    };
    await expect(
      processLocalFixture(
        { repositoryId: inserted.repository.id, jobId: inserted.job.id },
        store,
        source,
        provider,
      ),
    ).rejects.toThrow('provider unavailable');
    const job = await store.getJob(inserted.job.id);
    expect(job?.status).toBe('FAILED');
    expect(job?.stage).toBe('EMBEDDING');
    expect(await store.getLatestReadySnapshot(inserted.repository.id)).toBeNull();
    expect((await store.getSnapshot(job?.snapshotId ?? ''))?.status).toBe('FAILED');
  });

  it('keeps the source snapshot ready when optional PR sync is unavailable', async () => {
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
      undefined,
      undefined,
      {
        async getRepository() {
          return {
            owner: 'octocat',
            repo: 'Hello-World',
            defaultBranch: 'main',
            description: null,
            stars: 0,
            forks: 0,
            language: null,
            private: false,
            sizeKb: 1,
            htmlUrl: 'https://github.com/octocat/Hello-World',
          };
        },
        async getPullRequests() {
          throw new Error('rate limited');
        },
        async getIssues() {
          return [
            {
              number: 1,
              title: 'A bug',
              body: null,
              author: 'tester',
              state: 'open',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ];
        },
      },
    );
    const job = await store.getJob(inserted.job.id);
    expect(job?.status).toBe('READY');
    expect(job?.progress?.message).toContain('Some GitHub context could not be loaded');
    expect(job?.progress?.commitsIndexed).toBe(1);
    expect(job?.progress?.issuesIndexed).toBe(1);
    expect(store.issueRows.get(inserted.repository.id)?.[0]?.title).toBe('A bug');
  });
});
