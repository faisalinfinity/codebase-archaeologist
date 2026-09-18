import type { IndexJobDto, RepositoryDto, SnapshotDto } from '@archaeologist/shared';

import type {
  IndexJobPatch,
  InsertedRepository,
  InsertFileInput,
  InsertRepositoryInput,
  RepositoryPatch,
  RepositoryStore,
  UpsertSnapshotInput,
  UpsertUserInput,
} from './repository-store';

function nowIso(): string {
  return new Date().toISOString();
}

function emptyJob(repositoryId: string): IndexJobDto {
  const now = nowIso();
  return {
    id: crypto.randomUUID(),
    repositoryId,
    snapshotId: null,
    jobType: 'repository:index',
    status: 'PENDING',
    stage: 'PENDING',
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    progress: { message: 'Waiting for the index worker.' },
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export class InMemoryRepositoryStore implements RepositoryStore {
  readonly users = new Map<string, UpsertUserInput>();
  readonly repositories = new Map<string, RepositoryDto>();
  readonly jobs = new Map<string, IndexJobDto>();
  readonly snapshots = new Map<string, SnapshotDto>();
  readonly files = new Map<string, InsertFileInput[]>();

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

  async insertRepository(input: InsertRepositoryInput): Promise<InsertedRepository> {
    const now = nowIso();
    const repository: RepositoryDto = {
      id: crypto.randomUUID(),
      ownerUserId: input.ownerUserId,
      githubOwner: input.githubOwner,
      githubRepo: input.githubRepo,
      githubUrl: input.githubUrl,
      defaultBranch: input.defaultBranch ?? null,
      description: input.description ?? null,
      stars: input.stars ?? null,
      forks: input.forks ?? null,
      language: input.language ?? null,
      status: 'PENDING',
      lastIndexedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.repositories.set(repository.id, repository);
    const job = emptyJob(repository.id);
    this.jobs.set(job.id, job);
    return { repository, job };
  }

  async updateRepository(id: string, patch: RepositoryPatch): Promise<RepositoryDto | null> {
    const existing = this.repositories.get(id);
    if (!existing) {
      return null;
    }
    const next: RepositoryDto = {
      ...existing,
      status: patch.status ?? existing.status,
      defaultBranch:
        patch.defaultBranch === undefined ? existing.defaultBranch : patch.defaultBranch,
      description: patch.description === undefined ? existing.description : patch.description,
      stars: patch.stars === undefined ? existing.stars : patch.stars,
      forks: patch.forks === undefined ? existing.forks : patch.forks,
      language: patch.language === undefined ? existing.language : patch.language,
      lastIndexedAt:
        patch.lastIndexedAt === undefined
          ? existing.lastIndexedAt
          : patch.lastIndexedAt
            ? patch.lastIndexedAt.toISOString()
            : null,
      updatedAt: nowIso(),
    };
    this.repositories.set(id, next);
    return next;
  }

  async deleteByOwnerAndId(ownerUserId: string, id: string): Promise<boolean> {
    const existing = this.repositories.get(id);
    if (!existing || existing.ownerUserId !== ownerUserId) {
      return false;
    }
    this.repositories.delete(id);
    return true;
  }

  async getLatestJob(repositoryId: string): Promise<IndexJobDto | null> {
    const jobs = [...this.jobs.values()]
      .filter((job) => job.repositoryId === repositoryId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return jobs[0] ?? null;
  }

  async getJob(jobId: string): Promise<IndexJobDto | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async createIndexJob(repositoryId: string): Promise<IndexJobDto> {
    const job = emptyJob(repositoryId);
    this.jobs.set(job.id, job);
    return job;
  }

  async updateJob(jobId: string, patch: IndexJobPatch): Promise<IndexJobDto | null> {
    const existing = this.jobs.get(jobId);
    if (!existing) {
      return null;
    }
    const next: IndexJobDto = {
      ...existing,
      status: patch.status ?? existing.status,
      stage: patch.stage ?? existing.stage,
      snapshotId: patch.snapshotId === undefined ? existing.snapshotId : patch.snapshotId,
      errorCode: patch.errorCode === undefined ? existing.errorCode : patch.errorCode,
      errorMessage: patch.errorMessage === undefined ? existing.errorMessage : patch.errorMessage,
      retryCount: patch.retryCount ?? existing.retryCount,
      progress: patch.progress === undefined ? existing.progress : patch.progress,
      startedAt:
        patch.startedAt === undefined
          ? existing.startedAt
          : patch.startedAt
            ? patch.startedAt.toISOString()
            : null,
      completedAt:
        patch.completedAt === undefined
          ? existing.completedAt
          : patch.completedAt
            ? patch.completedAt.toISOString()
            : null,
      updatedAt: nowIso(),
    };
    this.jobs.set(jobId, next);
    return next;
  }

  async upsertSnapshot(input: UpsertSnapshotInput): Promise<SnapshotDto> {
    const existing = [...this.snapshots.values()].find(
      (row) => row.repositoryId === input.repositoryId && row.commitSha === input.commitSha,
    );
    const now = nowIso();
    const snapshot: SnapshotDto = {
      id: existing?.id ?? crypto.randomUUID(),
      repositoryId: input.repositoryId,
      commitSha: input.commitSha,
      branch: input.branch,
      indexVersion: existing?.indexVersion ?? 1,
      status: input.status,
      startedAt: input.startedAt ? input.startedAt.toISOString() : (existing?.startedAt ?? now),
      completedAt: input.completedAt ? input.completedAt.toISOString() : null,
      errorMessage: input.errorMessage ?? null,
      createdAt: existing?.createdAt ?? now,
    };
    this.snapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  async getSnapshot(id: string): Promise<SnapshotDto | null> {
    return this.snapshots.get(id) ?? null;
  }

  async getLatestSnapshot(repositoryId: string): Promise<SnapshotDto | null> {
    const rows = [...this.snapshots.values()]
      .filter((row) => row.repositoryId === repositoryId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows[0] ?? null;
  }

  async replaceSnapshotFiles(snapshotId: string, files: InsertFileInput[]): Promise<void> {
    this.files.set(snapshotId, files);
  }

  async countFiles(snapshotId: string): Promise<number> {
    return this.files.get(snapshotId)?.length ?? 0;
  }
}
