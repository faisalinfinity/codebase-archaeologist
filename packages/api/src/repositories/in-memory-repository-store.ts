import type { IndexJobDto, RepositoryDto, SnapshotDto } from '@archaeologist/shared';

import type {
  IndexJobPatch,
  InsertedRepository,
  InsertFileInput,
  IndexedChunk,
  IndexedFile,
  SearchCandidate,
  InsertRepositoryInput,
  RepositoryPatch,
  RepositoryStore,
  UpsertSnapshotInput,
  UpsertUserInput,
} from './repository-store';
import { assertEmbedding } from '../embeddings/embedding-provider';
import { resolveImport } from './resolve-import';

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
  readonly chunks = new Map<string, IndexedChunk[]>();

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

  async getLatestReadySnapshot(repositoryId: string): Promise<SnapshotDto | null> {
    const rows = [...this.snapshots.values()]
      .filter((row) => row.repositoryId === repositoryId && row.status === 'READY')
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
    return rows[0] ?? null;
  }

  async replaceSnapshotFiles(
    snapshotId: string,
    files: AsyncIterable<InsertFileInput> | Iterable<InsertFileInput>,
  ): Promise<void> {
    const collected: InsertFileInput[] = [];
    for await (const file of files) collected.push(file);
    this.files.set(snapshotId, collected);
    this.chunks.set(
      snapshotId,
      collected.flatMap((file) =>
        file.chunks.map((chunk) => ({
          id: crypto.randomUUID(),
          snapshotId,
          filePath: file.path,
          content: chunk.content,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          embedding: null,
          embeddingModel: null,
        })),
      ),
    );
  }

  async countFiles(snapshotId: string): Promise<number> {
    return this.files.get(snapshotId)?.length ?? 0;
  }

  async countChunks(snapshotId: string): Promise<number> {
    return this.chunks.get(snapshotId)?.length ?? 0;
  }

  async listFiles(
    snapshotId: string,
    limit: number,
    offset: number,
  ): Promise<Array<Pick<IndexedFile, 'id' | 'path' | 'language' | 'sizeBytes'>>> {
    return (this.files.get(snapshotId) ?? [])
      .map((file) => ({
        id: `${snapshotId}:${file.path}`,
        path: file.path,
        language: file.language,
        sizeBytes: file.sizeBytes,
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(offset, offset + limit);
  }

  async getFile(snapshotId: string, filePath: string): Promise<IndexedFile | null> {
    const allFiles = this.files.get(snapshotId) ?? [];
    const file = allFiles.find((entry) => entry.path === filePath);
    if (!file) return null;
    const paths = new Set(allFiles.map((entry) => entry.path));
    return {
      id: `${snapshotId}:${file.path}`,
      path: file.path,
      language: file.language,
      sizeBytes: file.sizeBytes,
      content: file.content,
      symbols: file.symbols,
      imports: file.imports.map((specifier) => ({
        specifier,
        targetPath: resolveImport(file.path, specifier, paths),
      })),
    };
  }

  async getChunksForEmbedding(snapshotId: string, afterId: string | null, limit: number) {
    return (this.chunks.get(snapshotId) ?? [])
      .filter((chunk) => !afterId || chunk.id > afterId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, limit)
      .map(({ id, content }) => ({ id, content }));
  }

  async updateChunkEmbeddings(
    snapshotId: string,
    model: string,
    items: Array<{ id: string; embedding: number[] }>,
  ): Promise<void> {
    const chunks = this.chunks.get(snapshotId) ?? [];
    for (const item of items) {
      assertEmbedding(item.embedding);
      const chunk = chunks.find((row) => row.id === item.id);
      if (!chunk) throw new Error('Indexed chunk is missing.');
      chunk.embedding = item.embedding;
      chunk.embeddingModel = model;
    }
  }

  async hasEmbeddings(snapshotId: string, model: string): Promise<boolean> {
    return (this.chunks.get(snapshotId) ?? []).some(
      (chunk) => chunk.embeddingModel === model && chunk.embedding,
    );
  }

  async searchLexical(
    snapshotId: string,
    query: string,
    limit: number,
  ): Promise<SearchCandidate[]> {
    const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])];
    if (terms.length === 0) return [];
    return (this.chunks.get(snapshotId) ?? [])
      .map((chunk) => {
        const content = chunk.content.toLowerCase();
        const score = terms.reduce((total, term) => total + (content.includes(term) ? 1 : 0), 0);
        return {
          chunkId: chunk.id,
          filePath: chunk.filePath,
          content: chunk.content,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          score,
        };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async searchSemantic(
    snapshotId: string,
    model: string,
    vector: number[],
    limit: number,
  ): Promise<SearchCandidate[]> {
    assertEmbedding(vector);
    const queryMagnitude = Math.hypot(...vector);
    return (this.chunks.get(snapshotId) ?? [])
      .filter((chunk) => chunk.embeddingModel === model && chunk.embedding)
      .map((chunk) => {
        const embedding = chunk.embedding ?? [];
        const dot = embedding.reduce((sum, value, index) => sum + value * (vector[index] ?? 0), 0);
        const magnitude = Math.hypot(...embedding) * queryMagnitude;
        return {
          chunkId: chunk.id,
          filePath: chunk.filePath,
          content: chunk.content,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          score: magnitude === 0 ? 0 : dot / magnitude,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
