import { describe, expect, it } from 'vitest';

import { ForbiddenError, NotFoundError } from '../errors';
import { errorFromCode } from '../errors';
import type { GitHubRepoMetadata, GitHubRepositoryReader } from '../github/github-repo-client';
import { NoopIndexQueue } from '../queue/index-queue';
import { InMemoryRepositoryStore } from './in-memory-repository-store';
import { RepositoryService } from './repository-service';

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
});
