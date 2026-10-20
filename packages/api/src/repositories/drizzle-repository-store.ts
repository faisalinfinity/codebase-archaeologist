import { and, asc, count, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';

import {
  files,
  codeChunks,
  codeSymbols,
  commits,
  commitFiles,
  dependencies,
  documents,
  getDatabase,
  indexJobs,
  issues,
  pullRequests,
  pullRequestFiles,
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
  InsertCommitInput,
  InsertPullRequestInput,
  InsertIssueInput,
  RepositoryPatch,
  RepositoryStore,
  UpsertSnapshotInput,
  UpsertUserInput,
} from './repository-store';
import { assertEmbedding } from '../embeddings/embedding-provider';
import { resolveImport } from './resolve-import';
import { buildSymbolEdges, type GraphFile } from './symbol-graph';

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
    return this.db.transaction(async (tx) => {
      await tx
        .select({ id: repositories.id })
        .from(repositories)
        .where(eq(repositories.id, repositoryId))
        .for('update');
      const [active] = await tx
        .select()
        .from(indexJobs)
        .where(
          and(
            eq(indexJobs.repositoryId, repositoryId),
            sql`${indexJobs.status} NOT IN ('READY', 'FAILED')`,
          ),
        )
        .orderBy(desc(indexJobs.createdAt))
        .limit(1);
      if (active) return toJobDto(active);
      const rows = await tx
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
    });
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
            ...(patch.progress.commitsIndexed !== undefined
              ? { commitsIndexed: patch.progress.commitsIndexed }
              : {}),
            ...(patch.progress.pullRequestsIndexed !== undefined
              ? { pullRequestsIndexed: patch.progress.pullRequestsIndexed }
              : {}),
            ...(patch.progress.issuesIndexed !== undefined
              ? { issuesIndexed: patch.progress.issuesIndexed }
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
      const graphFiles: GraphFile[] = [];
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
          graphFiles.push({
            path: file.path,
            symbols: file.symbols,
            references: file.references,
            aliases: file.aliases,
          });
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
      const aliases = graphFiles.flatMap((file) => file.aliases ?? []);
      for (let i = 0; i < pendingImports.length; i += 200) {
        await tx.insert(dependencies).values(
          pendingImports.slice(i, i + 200).map((entry) => {
            const targetPath = resolveImport(
              entry.sourcePath,
              entry.specifier,
              availablePaths,
              aliases,
            );
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
      const symbolRows = await tx
        .select({
          id: codeSymbols.id,
          fileId: codeSymbols.fileId,
          name: codeSymbols.name,
          line: codeSymbols.startLine,
        })
        .from(codeSymbols)
        .where(eq(codeSymbols.snapshotId, snapshotId));
      const symbolIds = new Map(
        symbolRows.map((symbol) => [`${symbol.fileId}:${symbol.name}:${symbol.line}`, symbol.id]),
      );
      const edges = buildSymbolEdges(graphFiles);
      const repositoryId =
        pendingImports[0]?.repositoryId ??
        (
          await tx
            .select({ repositoryId: repositorySnapshots.repositoryId })
            .from(repositorySnapshots)
            .where(eq(repositorySnapshots.id, snapshotId))
        )[0]?.repositoryId;
      for (let i = 0; repositoryId && i < edges.length; i += 200)
        await tx.insert(dependencies).values(
          edges.slice(i, i + 200).map((edge) => ({
            repositoryId,
            snapshotId,
            sourceFileId: ids.get(edge.sourcePath),
            targetFileId: ids.get(edge.targetPath),
            sourceSymbolId: symbolIds.get(
              `${ids.get(edge.sourcePath)}:${edge.sourceName}:${edge.sourceLine}`,
            ),
            targetSymbolId: symbolIds.get(
              `${ids.get(edge.targetPath)}:${edge.targetName}:${edge.targetLine}`,
            ),
            relationshipType: edge.relationshipType,
          })),
        );
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

  async replaceCommitHistory(repositoryId: string, history: InsertCommitInput[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(commits).where(eq(commits.repositoryId, repositoryId));
      for (const entry of history) {
        const rows = await tx
          .insert(commits)
          .values({
            repositoryId,
            sha: entry.sha,
            parentSha: entry.parentSha,
            authorName: entry.authorName,
            committedAt: entry.committedAt,
            message: entry.message,
          })
          .returning({ id: commits.id });
        const commitId = rows[0]?.id;
        if (!commitId) throw new Error('Could not save commit history.');
        for (let i = 0; i < entry.files.length; i += 100) {
          await tx.insert(commitFiles).values(
            entry.files.slice(i, i + 100).map((file) => ({
              commitId,
              path: file.path,
              changeType: file.changeType,
            })),
          );
        }
      }
    });
  }

  async replacePullRequests(
    repositoryId: string,
    entries: InsertPullRequestInput[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(pullRequests).where(eq(pullRequests.repositoryId, repositoryId));
      for (const item of entries) {
        const [row] = await tx
          .insert(pullRequests)
          .values({
            repositoryId,
            number: item.number,
            title: item.title,
            body: item.body,
            author: item.author,
            state: item.state,
            createdAt: item.createdAt,
            mergedAt: item.mergedAt,
            updatedAt: item.updatedAt,
            metadataJson: {
              filesComplete: item.filesComplete ?? false,
              relatedIssues: item.relatedIssues ?? [],
            },
          })
          .returning({ id: pullRequests.id });
        if (!row) throw new Error('Could not save pull request.');
        for (let i = 0; i < (item.files?.length ?? 0); i += 100)
          await tx.insert(pullRequestFiles).values(
            item.files!.slice(i, i + 100).map((file) => ({
              pullRequestId: row.id,
              path: file.path,
              changeType: file.changeType,
            })),
          );
      }
    });
  }

  async replaceIssues(repositoryId: string, entries: InsertIssueInput[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(issues).where(eq(issues.repositoryId, repositoryId));
      for (let i = 0; i < entries.length; i += 100) {
        await tx.insert(issues).values(
          entries.slice(i, i + 100).map((item) => ({
            repositoryId,
            number: item.number,
            title: item.title,
            body: item.body,
            author: item.author,
            state: item.state,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            metadataJson: { filePaths: item.filePaths ?? [] },
          })),
        );
      }
    });
  }

  async listCommits(repositoryId: string, limit: number, offset = 0, filePath?: string) {
    const rows = await this.db
      .select()
      .from(commits)
      .where(
        and(
          eq(commits.repositoryId, repositoryId),
          filePath
            ? sql`EXISTS (SELECT 1 FROM commit_files cf WHERE cf.commit_id = ${commits.id} AND cf.path = ${filePath})`
            : undefined,
        ),
      )
      .orderBy(desc(commits.committedAt), desc(commits.id))
      .limit(limit)
      .offset(offset);
    const changed =
      rows.length > 0
        ? await this.db
            .select({
              commitId: commitFiles.commitId,
              path: commitFiles.path,
              changeType: commitFiles.changeType,
            })
            .from(commitFiles)
            .where(
              inArray(
                commitFiles.commitId,
                rows.map((row) => row.id),
              ),
            )
        : [];
    const byCommit = new Map<string, Array<{ path: string; changeType: string }>>();
    for (const file of changed) {
      const list = byCommit.get(file.commitId) ?? [];
      list.push({ path: file.path, changeType: file.changeType });
      byCommit.set(file.commitId, list);
    }
    return rows.map((row) => ({
      sha: row.sha,
      parentSha: row.parentSha,
      authorName: row.authorName,
      committedAt: row.committedAt?.toISOString() ?? null,
      message: row.message,
      files: (byCommit.get(row.id) ?? []).sort((a, b) => a.path.localeCompare(b.path)),
    }));
  }

  async listPullRequests(repositoryId: string, limit: number) {
    const rows = await this.db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.repositoryId, repositoryId))
      .orderBy(desc(pullRequests.updatedAt), desc(pullRequests.number))
      .limit(limit);
    const changed = rows.length
      ? await this.db
          .select()
          .from(pullRequestFiles)
          .where(
            inArray(
              pullRequestFiles.pullRequestId,
              rows.map((row) => row.id),
            ),
          )
      : [];
    return rows.map((row) => ({
      files: changed
        .filter((file) => file.pullRequestId === row.id)
        .map((file) => ({ path: file.path, changeType: file.changeType ?? 'modified' })),
      filesComplete: row.metadataJson?.filesComplete === true,
      relatedIssues: Array.isArray(row.metadataJson?.relatedIssues)
        ? row.metadataJson.relatedIssues.filter(
            (value): value is number => typeof value === 'number',
          )
        : [],
      number: row.number,
      title: row.title,
      body: row.body,
      author: row.author,
      state: row.state,
      createdAt: row.createdAt?.toISOString() ?? null,
      mergedAt: row.mergedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    }));
  }

  async listIssues(repositoryId: string, limit: number) {
    const rows = await this.db
      .select()
      .from(issues)
      .where(eq(issues.repositoryId, repositoryId))
      .orderBy(desc(issues.updatedAt), desc(issues.number))
      .limit(limit);
    return rows.map((row) => ({
      filePaths: Array.isArray(row.metadataJson?.filePaths)
        ? row.metadataJson.filePaths.filter((value): value is string => typeof value === 'string')
        : [],
      number: row.number,
      title: row.title,
      body: row.body,
      author: row.author,
      state: row.state,
      createdAt: row.createdAt?.toISOString() ?? null,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    }));
  }

  async listImportEdges(snapshotId: string) {
    const rows = await this.db
      .select({
        sourceFileId: dependencies.sourceFileId,
        targetFileId: dependencies.targetFileId,
      })
      .from(dependencies)
      .where(
        and(
          eq(dependencies.snapshotId, snapshotId),
          eq(dependencies.relationshipType, 'imports'),
          isNotNull(dependencies.sourceFileId),
          isNotNull(dependencies.targetFileId),
        ),
      )
      .limit(10_000);
    const fileRows = await this.db
      .select({ id: files.id, path: files.path })
      .from(files)
      .where(eq(files.snapshotId, snapshotId));
    const paths = new Map(fileRows.map((file) => [file.id, file.path]));
    return rows.flatMap((edge) => {
      const sourcePath = edge.sourceFileId ? paths.get(edge.sourceFileId) : null;
      const targetPath = edge.targetFileId ? paths.get(edge.targetFileId) : null;
      return sourcePath && targetPath ? [{ sourcePath, targetPath }] : [];
    });
  }

  async listSymbolEdges(snapshotId: string) {
    const rows = await this.db.execute(sql`
      SELECT sf.path AS "sourcePath", ss.name AS "sourceName", ss.start_line AS "sourceLine",
             tf.path AS "targetPath", ts.name AS "targetName", ts.start_line AS "targetLine",
             d.relationship_type AS "relationshipType"
      FROM dependencies d
      JOIN files sf ON sf.id = d.source_file_id
      JOIN files tf ON tf.id = d.target_file_id
      JOIN code_symbols ss ON ss.id = d.source_symbol_id
      JOIN code_symbols ts ON ts.id = d.target_symbol_id
      WHERE d.snapshot_id = ${snapshotId}::uuid AND d.relationship_type IN ('calls', 'constructs', 'extends')
      ORDER BY sf.path, ss.start_line LIMIT 10000
    `);
    return rows.map((row) => ({
      sourcePath: String(row.sourcePath),
      sourceName: String(row.sourceName),
      sourceLine: Number(row.sourceLine),
      targetPath: String(row.targetPath),
      targetName: String(row.targetName),
      targetLine: Number(row.targetLine),
      relationshipType: String(row.relationshipType),
    }));
  }
}
