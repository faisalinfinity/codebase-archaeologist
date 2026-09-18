import { and, count, desc, eq } from 'drizzle-orm';

import {
  files,
  getDatabase,
  indexJobs,
  repositories,
  repositorySnapshots,
  users,
  type Database,
} from '@archaeologist/db';
import type {
  IndexJobDto,
  IndexJobProgress,
  RepositoryDto,
  SnapshotDto,
} from '@archaeologist/shared';

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

function toRepositoryDto(row: typeof repositories.$inferSelect): RepositoryDto {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    githubOwner: row.githubOwner,
    githubRepo: row.githubRepo,
    githubUrl: row.githubUrl,
    defaultBranch: row.defaultBranch,
    description: row.description,
    stars: row.stars,
    forks: row.forks,
    language: row.language,
    status: row.status,
    lastIndexedAt: row.lastIndexedAt ? row.lastIndexedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function asProgress(value: Record<string, unknown> | null | undefined): IndexJobProgress | null {
  if (!value) {
    return null;
  }
  return value as IndexJobProgress;
}

function toJobDto(row: typeof indexJobs.$inferSelect): IndexJobDto {
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    snapshotId: row.snapshotId,
    jobType: row.jobType,
    status: row.status,
    stage: row.stage,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    retryCount: row.retryCount,
    progress: asProgress(row.progressJson),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSnapshotDto(row: typeof repositorySnapshots.$inferSelect): SnapshotDto {
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    commitSha: row.commitSha,
    branch: row.branch,
    indexVersion: row.indexVersion,
    status: row.status,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  };
}

export class DrizzleRepositoryStore implements RepositoryStore {
  constructor(private readonly db: Database = getDatabase()) {}

  async upsertUser(input: UpsertUserInput): Promise<void> {
    await this.db
      .insert(users)
      .values({
        id: input.id,
        email: input.email || 'unknown@localhost',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: input.email || 'unknown@localhost',
          updatedAt: new Date(),
        },
      });
  }

  async listByOwner(ownerUserId: string): Promise<RepositoryDto[]> {
    const rows = await this.db
      .select()
      .from(repositories)
      .where(eq(repositories.ownerUserId, ownerUserId))
      .orderBy(desc(repositories.createdAt));
    return rows.map(toRepositoryDto);
  }

  async getById(id: string): Promise<RepositoryDto | null> {
    const rows = await this.db.select().from(repositories).where(eq(repositories.id, id)).limit(1);
    const row = rows[0];
    return row ? toRepositoryDto(row) : null;
  }

  async findByOwnerAndGithub(
    ownerUserId: string,
    githubOwner: string,
    githubRepo: string,
  ): Promise<RepositoryDto | null> {
    const rows = await this.db
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.ownerUserId, ownerUserId),
          eq(repositories.githubOwner, githubOwner),
          eq(repositories.githubRepo, githubRepo),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? toRepositoryDto(row) : null;
  }

  async insertRepository(input: InsertRepositoryInput): Promise<InsertedRepository> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(repositories)
        .values({
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
        })
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error('Failed to insert repository.');
      }
      const jobRows = await tx
        .insert(indexJobs)
        .values({
          repositoryId: row.id,
          jobType: 'repository:index',
          status: 'PENDING',
          stage: 'PENDING',
          progressJson: { message: 'Waiting for the index worker.' },
        })
        .returning();
      const job = jobRows[0];
      if (!job) {
        throw new Error('Failed to insert index job.');
      }
      return { repository: toRepositoryDto(row), job: toJobDto(job) };
    });
  }

  async updateRepository(id: string, patch: RepositoryPatch): Promise<RepositoryDto | null> {
    const set: Partial<typeof repositories.$inferInsert> = { updatedAt: new Date() };
    if (patch.status !== undefined) {
      set.status = patch.status as typeof repositories.$inferInsert.status;
    }
    if (patch.defaultBranch !== undefined) {
      set.defaultBranch = patch.defaultBranch;
    }
    if (patch.description !== undefined) {
      set.description = patch.description;
    }
    if (patch.stars !== undefined) {
      set.stars = patch.stars;
    }
    if (patch.forks !== undefined) {
      set.forks = patch.forks;
    }
    if (patch.language !== undefined) {
      set.language = patch.language;
    }
    if (patch.lastIndexedAt !== undefined) {
      set.lastIndexedAt = patch.lastIndexedAt;
    }
    const rows = await this.db
      .update(repositories)
      .set(set)
      .where(eq(repositories.id, id))
      .returning();
    const row = rows[0];
    return row ? toRepositoryDto(row) : null;
  }

  async deleteByOwnerAndId(ownerUserId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(repositories)
      .where(and(eq(repositories.id, id), eq(repositories.ownerUserId, ownerUserId)))
      .returning({ id: repositories.id });
    return deleted.length > 0;
  }

  async getLatestJob(repositoryId: string): Promise<IndexJobDto | null> {
    const rows = await this.db
      .select()
      .from(indexJobs)
      .where(eq(indexJobs.repositoryId, repositoryId))
      .orderBy(desc(indexJobs.createdAt))
      .limit(1);
    const row = rows[0];
    return row ? toJobDto(row) : null;
  }

  async getJob(jobId: string): Promise<IndexJobDto | null> {
    const rows = await this.db.select().from(indexJobs).where(eq(indexJobs.id, jobId)).limit(1);
    const row = rows[0];
    return row ? toJobDto(row) : null;
  }

  async createIndexJob(repositoryId: string): Promise<IndexJobDto> {
    const rows = await this.db
      .insert(indexJobs)
      .values({
        repositoryId,
        jobType: 'repository:index',
        status: 'PENDING',
        stage: 'PENDING',
        progressJson: { message: 'Waiting for the index worker.' },
      })
      .returning();
    const row = rows[0];
    if (!row) {
      throw new Error('Failed to insert index job.');
    }
    return toJobDto(row);
  }

  async updateJob(jobId: string, patch: IndexJobPatch): Promise<IndexJobDto | null> {
    const set: Partial<typeof indexJobs.$inferInsert> = { updatedAt: new Date() };
    if (patch.status !== undefined) {
      set.status = patch.status as typeof indexJobs.$inferInsert.status;
    }
    if (patch.stage !== undefined) {
      set.stage = patch.stage as typeof indexJobs.$inferInsert.stage;
    }
    if (patch.snapshotId !== undefined) {
      set.snapshotId = patch.snapshotId;
    }
    if (patch.errorCode !== undefined) {
      set.errorCode = patch.errorCode;
    }
    if (patch.errorMessage !== undefined) {
      set.errorMessage = patch.errorMessage;
    }
    if (patch.retryCount !== undefined) {
      set.retryCount = patch.retryCount;
    }
    if (patch.progress !== undefined) {
      set.progressJson = patch.progress
        ? {
            ...(patch.progress.message ? { message: patch.progress.message } : {}),
            ...(patch.progress.filesIndexed !== undefined
              ? { filesIndexed: patch.progress.filesIndexed }
              : {}),
            ...(patch.progress.filesSkipped !== undefined
              ? { filesSkipped: patch.progress.filesSkipped }
              : {}),
            ...(patch.progress.filesSeen !== undefined
              ? { filesSeen: patch.progress.filesSeen }
              : {}),
            ...(patch.progress.skippedReasons
              ? { skippedReasons: patch.progress.skippedReasons }
              : {}),
          }
        : null;
    }
    if (patch.startedAt !== undefined) {
      set.startedAt = patch.startedAt;
    }
    if (patch.completedAt !== undefined) {
      set.completedAt = patch.completedAt;
    }
    const rows = await this.db
      .update(indexJobs)
      .set(set)
      .where(eq(indexJobs.id, jobId))
      .returning();
    const row = rows[0];
    return row ? toJobDto(row) : null;
  }

  async upsertSnapshot(input: UpsertSnapshotInput): Promise<SnapshotDto> {
    const rows = await this.db
      .insert(repositorySnapshots)
      .values({
        repositoryId: input.repositoryId,
        commitSha: input.commitSha,
        branch: input.branch,
        status: input.status,
        startedAt: input.startedAt ?? new Date(),
        completedAt: input.completedAt ?? null,
        errorMessage: input.errorMessage ?? null,
      })
      .onConflictDoUpdate({
        target: [repositorySnapshots.repositoryId, repositorySnapshots.commitSha],
        set: {
          branch: input.branch,
          status: input.status,
          startedAt: input.startedAt ?? new Date(),
          completedAt: input.completedAt ?? null,
          errorMessage: input.errorMessage ?? null,
        },
      })
      .returning();
    const row = rows[0];
    if (!row) {
      throw new Error('Failed to upsert snapshot.');
    }
    return toSnapshotDto(row);
  }

  async getSnapshot(id: string): Promise<SnapshotDto | null> {
    const rows = await this.db
      .select()
      .from(repositorySnapshots)
      .where(eq(repositorySnapshots.id, id))
      .limit(1);
    const row = rows[0];
    return row ? toSnapshotDto(row) : null;
  }

  async getLatestSnapshot(repositoryId: string): Promise<SnapshotDto | null> {
    const rows = await this.db
      .select()
      .from(repositorySnapshots)
      .where(eq(repositorySnapshots.repositoryId, repositoryId))
      .orderBy(desc(repositorySnapshots.createdAt))
      .limit(1);
    const row = rows[0];
    return row ? toSnapshotDto(row) : null;
  }

  async replaceSnapshotFiles(snapshotId: string, filesToInsert: InsertFileInput[]): Promise<void> {
    await this.db.delete(files).where(eq(files.snapshotId, snapshotId));
    if (filesToInsert.length === 0) {
      return;
    }
    const chunkSize = 200;
    for (let i = 0; i < filesToInsert.length; i += chunkSize) {
      const chunk = filesToInsert.slice(i, i + chunkSize);
      await this.db.insert(files).values(
        chunk.map((file) => ({
          repositoryId: file.repositoryId,
          snapshotId: file.snapshotId,
          path: file.path,
          language: file.language,
          sizeBytes: file.sizeBytes,
          sha: file.sha,
          isBinary: file.isBinary,
          isGenerated: file.isGenerated,
        })),
      );
    }
  }

  async countFiles(snapshotId: string): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(files)
      .where(eq(files.snapshotId, snapshotId));
    return Number(rows[0]?.value ?? 0);
  }
}
