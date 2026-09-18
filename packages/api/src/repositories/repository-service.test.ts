import { describe, expect, it } from 'vitest';

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { InMemoryRepositoryStore } from './in-memory-repository-store';
import { RepositoryService } from './repository-service';

const userA = { id: '11111111-1111-1111-1111-111111111111', email: 'a@example.com' };
const userB = { id: '22222222-2222-2222-2222-222222222222', email: 'b@example.com' };

function createService() {
  return new RepositoryService(new InMemoryRepositoryStore());
}

describe('RepositoryService', () => {
  it('creates a pending repository and rejects duplicates for the same owner', async () => {
    const service = createService();
    const created = await service.create(userA, { githubUrl: 'https://github.com/vercel/next.js' });
    expect(created.githubOwner).toBe('vercel');
    expect(created.githubRepo).toBe('next.js');
    expect(created.status).toBe('PENDING');
    expect(created.ownerUserId).toBe(userA.id);

    await expect(service.create(userA, { githubUrl: 'vercel/next.js' })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('does not let user B read or delete user A repositories', async () => {
    const service = createService();
    const created = await service.create(userA, { githubUrl: 'https://github.com/facebook/react' });

    await expect(service.get(userB, created.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.delete(userB, created.id)).rejects.toBeInstanceOf(ForbiddenError);

    const stillThere = await service.get(userA, created.id);
    expect(stillThere.id).toBe(created.id);
  });

  it('lists only the caller’s repositories', async () => {
    const service = createService();
    await service.create(userA, { githubUrl: 'https://github.com/vercel/next.js' });
    await service.create(userB, { githubUrl: 'https://github.com/vercel/next.js' });

    const aList = await service.list(userA);
    const bList = await service.list(userB);
    expect(aList).toHaveLength(1);
    expect(bList).toHaveLength(1);
    expect(aList[0]?.ownerUserId).toBe(userA.id);
    expect(bList[0]?.ownerUserId).toBe(userB.id);
  });

  it('rejects invalid GitHub URLs', async () => {
    const service = createService();
    await expect(
      service.create(userA, { githubUrl: 'https://evil.example/repo' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns not found for unknown ids', async () => {
    const service = createService();
    await expect(service.get(userA, '00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
