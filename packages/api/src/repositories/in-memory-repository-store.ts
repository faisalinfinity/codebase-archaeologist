import type { RepositoryDto } from '@archaeologist/shared';

import type { InsertRepositoryInput, RepositoryStore, UpsertUserInput } from './repository-store';

export class InMemoryRepositoryStore implements RepositoryStore {
  readonly users = new Map<string, UpsertUserInput>();
  readonly repositories = new Map<string, RepositoryDto>();
  readonly jobs: { repositoryId: string }[] = [];

  async upsertUser(input: UpsertUserInput): Promise<void> {
    this.users.set(input.id, input);
  }

  async listByOwner(ownerUserId: string): Promise<RepositoryDto[]> {
    return [...this.repositories.values()].filter((repo) => repo.ownerUserId === ownerUserId);
  }

  async getById(id: string): Promise<RepositoryDto | null> {
    return this.repositories.get(id) ?? null;
  }

  async findByOwnerAndGithub(
    ownerUserId: string,
    githubOwner: string,
    githubRepo: string,
  ): Promise<RepositoryDto | null> {
    return (
      [...this.repositories.values()].find(
        (repo) =>
          repo.ownerUserId === ownerUserId &&
          repo.githubOwner === githubOwner &&
          repo.githubRepo === githubRepo,
      ) ?? null
    );
  }

  async insertRepository(input: InsertRepositoryInput): Promise<RepositoryDto> {
    const now = new Date().toISOString();
    const repo: RepositoryDto = {
      id: crypto.randomUUID(),
      ownerUserId: input.ownerUserId,
      githubOwner: input.githubOwner,
      githubRepo: input.githubRepo,
      githubUrl: input.githubUrl,
      defaultBranch: null,
      description: null,
      status: 'PENDING',
      lastIndexedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.repositories.set(repo.id, repo);
    this.jobs.push({ repositoryId: repo.id });
    return repo;
  }

  async deleteByOwnerAndId(ownerUserId: string, id: string): Promise<boolean> {
    const existing = this.repositories.get(id);
    if (!existing || existing.ownerUserId !== ownerUserId) {
      return false;
    }
    this.repositories.delete(id);
    return true;
  }
}
