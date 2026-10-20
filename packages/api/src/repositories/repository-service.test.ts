import { describe, expect, it } from 'vitest';

import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { errorFromCode } from '../errors';
import type { GitHubRepoMetadata, GitHubRepositoryReader } from '../github/github-repo-client';
import { NoopIndexQueue } from '../queue/index-queue';
import { InMemoryRepositoryStore } from './in-memory-repository-store';
import { RepositoryService } from './repository-service';
import type { EmbeddingProvider } from '../embeddings/embedding-provider';

const userA = { id: '11111111-1111-1111-1111-111111111111', email: 'a@example.com' };
const userB = { id: '22222222-2222-2222-2222-222222222222', email: 'b@example.com' };

class FakeGitHub implements GitHubRepositoryReader {
  constructor(
    private readonly impl: (
      owner: string,
      repo: string,
    ) => Promise<GitHubRepoMetadata> | GitHubRepoMetadata = (owner, repo) => ({
      owner,
      repo,
      defaultBranch: 'main',
      description: 'fixture',
      stars: 1,
      forks: 0,
      language: 'TypeScript',
      private: false,
      sizeKb: 12,
      htmlUrl: `https://github.com/${owner}/${repo}`,
    }),
  ) {}

  async getRepository(owner: string, repo: string): Promise<GitHubRepoMetadata> {
    return this.impl(owner, repo);
  }
}

function createService(github: GitHubRepositoryReader = new FakeGitHub()) {
  const store = new InMemoryRepositoryStore();
  const queue = new NoopIndexQueue();
  return {
    store,
    queue,
    service: new RepositoryService(store, github, queue, { MAX_REPOSITORY_SIZE_MB: '500' }),
  };
}

describe('RepositoryService', () => {
  it('creates a pending repository, enqueues an index job, and reuses an already-added repo', async () => {
    const { service, queue } = createService();
    const created = await service.create(userA, {
      githubUrl: 'https://github.com/octocat/Hello-World',
    });
    expect(created.alreadyExists).toBe(false);
    expect(created.repository.githubOwner).toBe('octocat');
    expect(created.repository.githubRepo).toBe('Hello-World');
    expect(created.repository.status).toBe('PENDING');
    expect(created.repository.defaultBranch).toBe('main');
    expect(queue.jobs).toHaveLength(1);

    const again = await service.create(userA, { githubUrl: 'octocat/Hello-World' });
    expect(again.alreadyExists).toBe(true);
    expect(again.repository.id).toBe(created.repository.id);
    expect(queue.jobs).toHaveLength(1);
  });

  it('does not let user B read or delete user A repositories', async () => {
    const { service } = createService();
    const created = await service.create(userA, { githubUrl: 'https://github.com/facebook/react' });

    await expect(service.get(userB, created.repository.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.delete(userB, created.repository.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    const stillThere = await service.get(userA, created.repository.id);
    expect(stillThere.id).toBe(created.repository.id);
  });

  it('lists only the caller’s repositories', async () => {
    const { service } = createService();
    await service.create(userA, { githubUrl: 'https://github.com/vercel/next.js' });
    await service.create(userB, { githubUrl: 'https://github.com/vercel/next.js' });

    const aList = await service.list(userA);
    const bList = await service.list(userB);
    expect(aList).toHaveLength(1);
    expect(bList).toHaveLength(1);
    expect(aList[0]?.ownerUserId).toBe(userA.id);
    expect(bList[0]?.ownerUserId).toBe(userB.id);
  });

  it('rejects invalid GitHub URLs before calling GitHub', async () => {
    let called = false;
    const { service } = createService(
      new FakeGitHub(async () => {
        called = true;
        throw new Error('should not be called');
      }),
    );
    await expect(
      service.create(userA, { githubUrl: 'https://evil.example/repo' }),
    ).rejects.toMatchObject({
      code: 'INVALID_GITHUB_URL',
    });
    expect(called).toBe(false);
  });

  it('maps GitHub 404, private, rate limit, and too-large failures', async () => {
    const notFound = createService(
      new FakeGitHub(async () => {
        throw errorFromCode('REPOSITORY_NOT_FOUND');
      }),
    );
    await expect(
      notFound.service.create(userA, { githubUrl: 'https://github.com/octocat/missing' }),
    ).rejects.toMatchObject({ code: 'REPOSITORY_NOT_FOUND' });

    const priv = createService(
      new FakeGitHub(async () => {
        throw errorFromCode('PRIVATE_REPOSITORY');
      }),
    );
    await expect(
      priv.service.create(userA, { githubUrl: 'https://github.com/octocat/private-repo' }),
    ).rejects.toMatchObject({ code: 'PRIVATE_REPOSITORY' });

    const limited = createService(
      new FakeGitHub(async () => {
        throw errorFromCode('GITHUB_RATE_LIMITED');
      }),
    );
    await expect(
      limited.service.create(userA, { githubUrl: 'https://github.com/octocat/Hello-World' }),
    ).rejects.toMatchObject({ code: 'GITHUB_RATE_LIMITED' });

    const oversized = new RepositoryService(
      new InMemoryRepositoryStore(),
      new FakeGitHub(async (owner, repo) => ({
        owner,
        repo,
        defaultBranch: 'main',
        description: null,
        stars: 0,
        forks: 0,
        language: null,
        private: false,
        sizeKb: 900_000,
        htmlUrl: `https://github.com/${owner}/${repo}`,
      })),
      new NoopIndexQueue(),
      { MAX_REPOSITORY_SIZE_MB: '1' },
    );
    await expect(
      oversized.create(userA, { githubUrl: 'https://github.com/vercel/next.js' }),
    ).rejects.toMatchObject({ code: 'REPOSITORY_TOO_LARGE' });
  });

  it('returns not found for unknown ids', async () => {
    const { service } = createService();
    await expect(service.get(userA, '00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('exposes index status for the owner', async () => {
    const { service } = createService();
    const created = await service.create(userA, {
      githubUrl: 'https://github.com/octocat/Hello-World',
    });
    const status = await service.getIndexStatus(userA, created.repository.id);
    expect(status.job?.stage).toBe('PENDING');
    expect(status.alreadyIndexed).toBe(false);
  });

  it('only serves source from an owned READY snapshot and rejects traversal', async () => {
    const { service, store } = createService();
    const created = await service.create(userA, { githubUrl: 'https://github.com/octocat/source' });
    const id = created.repository.id;
    const snapshot = await store.upsertSnapshot({
      repositoryId: id,
      commitSha: 'abc123',
      branch: 'main',
      status: 'READY',
      completedAt: new Date(),
    });
    await store.replaceSnapshotFiles(snapshot.id, [
      {
        repositoryId: id,
        snapshotId: snapshot.id,
        path: 'src/index.ts',
        language: 'typescript',
        sizeBytes: 20,
        sha: 'abc',
        content: 'export const value = 1;',
        isBinary: false,
        isGenerated: false,
        symbols: [],
        chunks: [],
        imports: [],
      },
    ]);

    expect((await service.getIndexedFile(userA, id, 'src/index.ts')).file.content).toContain(
      'value',
    );
    await expect(service.getIndexedFile(userB, id, 'src/index.ts')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(service.getIndexedFile(userA, id, '../.env')).rejects.toBeInstanceOf(
      ValidationError,
    );
    await store.upsertSnapshot({
      repositoryId: id,
      commitSha: 'newer',
      branch: 'main',
      status: 'SCANNING',
    });
    expect((await service.getIndexedFile(userA, id, 'src/index.ts')).snapshot.commitSha).toBe(
      'abc123',
    );
  });

  it('searches ready chunks and enforces repository ownership', async () => {
    const { service, store, queue } = createService();
    const created = await service.create(userA, {
      githubUrl: 'https://github.com/octocat/searchable',
    });
    const snapshot = await store.upsertSnapshot({
      repositoryId: created.repository.id,
      commitSha: 'abc123',
      branch: 'main',
      status: 'READY',
      completedAt: new Date(),
    });
    await store.replaceSnapshotFiles(snapshot.id, [
      {
        repositoryId: created.repository.id,
        snapshotId: snapshot.id,
        path: 'src/auth.ts',
        language: 'typescript',
        sizeBytes: 30,
        sha: 'sha',
        content: 'export function authenticate() {}',
        isBinary: false,
        isGenerated: false,
        symbols: [],
        imports: [],
        chunks: [{ content: 'export function authenticate() {}', startLine: 1, endLine: 1 }],
      },
    ]);
    const lexical = await service.search(userA, created.repository.id, 'authenticate');
    expect(lexical.mode).toBe('lexical');
    expect(lexical.results[0]).toMatchObject({ filePath: 'src/auth.ts', startLine: 1 });
    await expect(
      service.search(userB, created.repository.id, 'authenticate'),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const provider: EmbeddingProvider = {
      model: 'fake',
      dimensions: 1536,
      async embed() {
        const vector = Array<number>(1536).fill(0);
        vector[0] = 1;
        return [vector];
      },
    };
    const chunk = (await store.getChunksForEmbedding(snapshot.id, null, 1))[0];
    if (!chunk) throw new Error('Test chunk missing.');
    const vector = Array<number>(1536).fill(0);
    vector[0] = 1;
    await store.updateChunkEmbeddings(snapshot.id, 'fake', [{ id: chunk.id, embedding: vector }]);
    const hybridService = new RepositoryService(store, new FakeGitHub(), queue, {}, provider);
    const hybrid = await hybridService.search(userA, created.repository.id, 'authenticate');
    expect(hybrid.mode).toBe('hybrid');
    expect(hybrid.results).toHaveLength(1);
    expect(hybrid.results[0]?.githubUrl).toContain('/blob/abc123/src/auth.ts#L1');
  });

  it('traces reverse imports and recent co-changes for an owned file', async () => {
    const { service, store } = createService();
    const created = await service.create(userA, { githubUrl: 'https://github.com/octocat/impact' });
    const repositoryId = created.repository.id;
    const snapshot = await store.upsertSnapshot({
      repositoryId,
      commitSha: 'abc123',
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
      symbols: [],
      chunks: [],
      imports,
    });
    await store.replaceSnapshotFiles(snapshot.id, [
      file('src/a.ts', ['./b']),
      file('src/b.ts', []),
      file('src/c.ts', ['./a']),
    ]);
    await store.replaceCommitHistory(repositoryId, [
      {
        sha: 'deadbeef',
        parentSha: null,
        authorName: 'Test',
        committedAt: new Date(),
        message: 'change authentication',
        files: [
          { path: 'src/a.ts', changeType: 'M' },
          { path: 'src/b.ts', changeType: 'M' },
        ],
      },
    ]);
    await store.replacePullRequests(repositoryId, [
      {
        number: 4,
        title: 'Improve auth',
        files: [{ path: 'src/b.ts', changeType: 'M' }],
        filesComplete: true,
        body: null,
        author: 'test',
        state: 'closed',
        createdAt: new Date(),
        mergedAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    await store.replaceIssues(repositoryId, [
      {
        number: 5,
        title: 'Auth issue',
        filePaths: ['src/b.ts'],
        body: null,
        author: 'test',
        state: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const impact = await service.getImpact(userA, repositoryId, 'src/b.ts');
    expect(impact.dependents).toEqual([
      { path: 'src/a.ts', distance: 1 },
      { path: 'src/c.ts', distance: 2 },
    ]);
    expect(impact.coChanged).toEqual([{ path: 'src/a.ts', commitCount: 1 }]);
    expect(impact.commits[0]?.message).toBe('change authentication');
    const history = await service.getHistory(userA, repositoryId, 'src/b.ts');
    expect(history.commits).toHaveLength(1);
    expect(history.pullRequests[0]?.number).toBe(4);
    expect(history.issues[0]?.number).toBe(5);
    await expect(service.getImpact(userB, repositoryId, 'src/b.ts')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(service.getImpact(userA, repositoryId, '../.env')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
