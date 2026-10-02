import { and, asc, count, desc, eq, gt, isNotNull, sql } from 'drizzle-orm';

import {
  files,
  codeChunks,
  codeSymbols,
  dependencies,
  documents,
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
            ...(patch.progress.chunksEmbedded !== undefined
              ? { chunksEmbedded: patch.progress.chunksEmbedded }
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

  async getLatestReadySnapshot(repositoryId: string): Promise<SnapshotDto | null> {
    const rows = await this.db
      .select()
      .from(repositorySnapshots)
      .where(
        and(
          eq(repositorySnapshots.repositoryId, repositoryId),
          eq(repositorySnapshots.status, 'READY'),
        ),
      )
      .orderBy(desc(repositorySnapshots.completedAt))
      .limit(1);
    return rows[0] ? toSnapshotDto(rows[0]) : null;
  }

  async replaceSnapshotFiles(
    snapshotId: string,
    filesToInsert: AsyncIterable<InsertFileInput> | Iterable<InsertFileInput>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(documents).where(eq(documents.snapshotId, snapshotId));
      await tx.delete(files).where(eq(files.snapshotId, snapshotId));
      const ids = new Map<string, string>();
      const pendingImports: Array<{
        sourcePath: string;
        sourceFileId: string;
        repositoryId: string;
        specifier: string;
      }> = [];

      const flush = async (batch: InsertFileInput[]): Promise<void> => {
        if (batch.length === 0) return;
        const rows = await tx
          .insert(files)
          .values(
            batch.map((file) => ({
              repositoryId: file.repositoryId,
              snapshotId: file.snapshotId,
              path: file.path,
              language: file.language,
              sizeBytes: file.sizeBytes,
              sha: file.sha,
              content: file.content,
              isBinary: file.isBinary,
              isGenerated: file.isGenerated,
            })),
          )
          .returning({ id: files.id, path: files.path });
        for (const row of rows) ids.set(row.path, row.id);
        for (const file of batch) {
          const fileId = ids.get(file.path);
          if (!fileId) throw new Error('Indexed file row is missing.');
          for (let i = 0; i < file.symbols.length; i += 100) {
            await tx.insert(codeSymbols).values(
              file.symbols.slice(i, i + 100).map((symbol) => ({
                fileId,
                repositoryId: file.repositoryId,
                snapshotId,
                name: symbol.name,
                symbolType: symbol.symbolType,
                startLine: symbol.startLine,
                endLine: symbol.endLine,
                signature: symbol.signature,
              })),
            );
          }
          for (let i = 0; i < file.chunks.length; i += 100) {
            await tx.insert(codeChunks).values(
              file.chunks.slice(i, i + 100).map((chunk) => ({
                fileId,
                repositoryId: file.repositoryId,
                snapshotId,
                chunkType: file.language === 'markdown' ? 'document' : 'source',
                content: chunk.content,
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                language: file.language,
              })),
            );
          }
          if (
            file.content !== null &&
            (file.language === 'markdown' ||
              /(^|\/)(Dockerfile|package\.json|tsconfig[^/]*\.json|\.env\.(example|sample|template))$/i.test(
                file.path,
              ))
          ) {
            await tx.insert(documents).values({
              repositoryId: file.repositoryId,
              snapshotId,
              fileId,
              title: file.path,
              content: file.content,
              docType: file.language === 'markdown' ? 'markdown' : 'configuration',
            });
          }
          for (const specifier of file.imports) {
            pendingImports.push({
              sourcePath: file.path,
              sourceFileId: fileId,
              repositoryId: file.repositoryId,
              specifier,
            });
          }
        }
      };

      // A bounded batch keeps source text out of the worker heap after each insert.
      let batch: InsertFileInput[] = [];
      for await (const file of filesToInsert) {
        batch.push(file);
        if (batch.length === 20) {
          await flush(batch);
          batch = [];
        }
      }
      await flush(batch);

      const availablePaths = new Set(ids.keys());
      for (let i = 0; i < pendingImports.length; i += 200) {
        await tx.insert(dependencies).values(
          pendingImports.slice(i, i + 200).map((entry) => {
            const targetPath = resolveImport(entry.sourcePath, entry.specifier, availablePaths);
            return {
              repositoryId: entry.repositoryId,
              snapshotId,
              sourceFileId: entry.sourceFileId,
              targetFileId: targetPath ? (ids.get(targetPath) ?? null) : null,
              relationshipType: 'imports',
              metadataJson: { specifier: entry.specifier },
            };
          }),
        );
      }
    });
  }

  async countFiles(snapshotId: string): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(files)
      .where(eq(files.snapshotId, snapshotId));
    return Number(rows[0]?.value ?? 0);
  }

  async countChunks(snapshotId: string): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(codeChunks)
      .where(eq(codeChunks.snapshotId, snapshotId));
    return Number(rows[0]?.value ?? 0);
  }

  async listFiles(
    snapshotId: string,
    limit: number,
    offset: number,
  ): Promise<Array<Pick<IndexedFile, 'id' | 'path' | 'language' | 'sizeBytes'>>> {
    return this.db
      .select({
        id: files.id,
        path: files.path,
        language: files.language,
        sizeBytes: files.sizeBytes,
      })
      .from(files)
      .where(eq(files.snapshotId, snapshotId))
      .orderBy(asc(files.path))
      .limit(limit)
      .offset(offset);
  }

  async getFile(snapshotId: string, filePath: string): Promise<IndexedFile | null> {
    const rows = await this.db
      .select()
      .from(files)
      .where(and(eq(files.snapshotId, snapshotId), eq(files.path, filePath)))
      .limit(1);
    const file = rows[0];
    if (!file) return null;
    const [symbols, imports] = await Promise.all([
      this.db
        .select({
          name: codeSymbols.name,
          symbolType: codeSymbols.symbolType,
          startLine: codeSymbols.startLine,
          endLine: codeSymbols.endLine,
          signature: codeSymbols.signature,
        })
        .from(codeSymbols)
        .where(eq(codeSymbols.fileId, file.id))
        .orderBy(asc(codeSymbols.startLine)),
      this.db
        .select({ specifier: dependencies.metadataJson, targetPath: files.path })
        .from(dependencies)
        .leftJoin(files, eq(dependencies.targetFileId, files.id))
        .where(eq(dependencies.sourceFileId, file.id)),
    ]);
    return {
      id: file.id,
      path: file.path,
      language: file.language,
      sizeBytes: file.sizeBytes,
      content: file.content,
      symbols,
      imports: imports.map((row) => ({
        specifier: typeof row.specifier?.specifier === 'string' ? row.specifier.specifier : '',
        targetPath: row.targetPath,
      })),
    };
  }

  async getChunksForEmbedding(snapshotId: string, afterId: string | null, limit: number) {
    const rows = await this.db
      .select({ id: codeChunks.id, content: codeChunks.content })
      .from(codeChunks)
      .where(
        and(
          eq(codeChunks.snapshotId, snapshotId),
          afterId ? gt(codeChunks.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(codeChunks.id))
      .limit(limit);
    return rows;
  }

  async updateChunkEmbeddings(
    snapshotId: string,
    model: string,
    items: Array<{ id: string; embedding: number[] }>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const item of items) {
        assertEmbedding(item.embedding);
        const rows = await tx
          .update(codeChunks)
          .set({
            embedding: item.embedding,
            embeddingModel: model,
            embeddingUpdatedAt: new Date(),
          })
          .where(and(eq(codeChunks.id, item.id), eq(codeChunks.snapshotId, snapshotId)))
          .returning({ id: codeChunks.id });
        if (rows.length !== 1) throw new Error('Indexed chunk is missing.');
      }
    });
  }

  async hasEmbeddings(snapshotId: string, model: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: codeChunks.id })
      .from(codeChunks)
      .where(
        and(
          eq(codeChunks.snapshotId, snapshotId),
          eq(codeChunks.embeddingModel, model),
          isNotNull(codeChunks.embedding),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async searchLexical(
    snapshotId: string,
    query: string,
    limit: number,
  ): Promise<SearchCandidate[]> {
    const tsQuery = sql`websearch_to_tsquery('simple', ${query})`;
    const rank = sql<number>`ts_rank_cd(to_tsvector('simple', ${codeChunks.content}), ${tsQuery})`;
    const rows = await this.db
      .select({
        chunkId: codeChunks.id,
        filePath: files.path,
        content: codeChunks.content,
        startLine: codeChunks.startLine,
        endLine: codeChunks.endLine,
        score: rank,
      })
      .from(codeChunks)
      .innerJoin(files, eq(codeChunks.fileId, files.id))
      .where(
        and(
          eq(codeChunks.snapshotId, snapshotId),
          sql`to_tsvector('simple', ${codeChunks.content}) @@ ${tsQuery}`,
        ),
      )
      .orderBy(desc(rank))
      .limit(limit);
    return rows;
  }

  async searchSemantic(
    snapshotId: string,
    model: string,
    vector: number[],
    limit: number,
  ): Promise<SearchCandidate[]> {
    assertEmbedding(vector);
    const distance = sql<number>`${codeChunks.embedding} <=> ${JSON.stringify(vector)}::vector`;
    const rows = await this.db
      .select({
        chunkId: codeChunks.id,
        filePath: files.path,
        content: codeChunks.content,
        startLine: codeChunks.startLine,
        endLine: codeChunks.endLine,
        score: sql<number>`1 - (${distance})`,
      })
      .from(codeChunks)
      .innerJoin(files, eq(codeChunks.fileId, files.id))
      .where(
        and(
          eq(codeChunks.snapshotId, snapshotId),
          eq(codeChunks.embeddingModel, model),
          isNotNull(codeChunks.embedding),
        ),
      )
      .orderBy(asc(distance))
      .limit(limit);
    return rows;
  }
}
