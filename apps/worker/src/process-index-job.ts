import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { GitHubRepositoryReader, RepositoryStore } from '@archaeologist/api';
import {
  assertPublicSize,
  embedChunks,
  EMBEDDING_DIMENSIONS,
  HttpError,
  type EmbeddingProvider,
} from '@archaeologist/api';
import {
  cloneGitRemote,
  analyzeSource,
  IngestionError,
  isInsideRoot,
  scanRepositoryTree,
  type CloneOptions,
  type CloneResult,
} from '@archaeologist/ingestion';
import { getIngestionLimits, type ErrorCode } from '@archaeologist/shared';

export interface IndexJobPayload {
  repositoryId: string;
  jobId: string;
}

export interface ProcessIndexJobDeps {
  store: RepositoryStore;
  clone: (options: CloneOptions) => Promise<CloneResult>;
  scan: typeof scanRepositoryTree;
  github?: GitHubRepositoryReader;
  embeddingProvider?: EmbeddingProvider | null;
  env?: Record<string, string | undefined>;
}

function logSafe(fields: Record<string, string | number | null | undefined>): void {
  console.log(JSON.stringify({ msg: 'index_job', ...fields }));
}

function asErrorCode(error: unknown): { code: ErrorCode; message: string } {
  if (error instanceof IngestionError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof HttpError && isErrorCode(error.code)) {
    return { code: error.code, message: error.message };
  }
  return {
    code: 'INDEX_FAILED',
    message: 'Indexing failed. Check the worker and retry the repository.',
  };
}

function isErrorCode(value: string): value is ErrorCode {
  return (
    value === 'INVALID_GITHUB_URL' ||
    value === 'REPOSITORY_NOT_FOUND' ||
    value === 'PRIVATE_REPOSITORY' ||
    value === 'GITHUB_RATE_LIMITED' ||
    value === 'REPOSITORY_TOO_LARGE' ||
    value === 'UNSUPPORTED_REPOSITORY' ||
    value === 'INDEX_FAILED' ||
    value === 'INDEX_TIMEOUT' ||
    value === 'REDIS_UNAVAILABLE'
  );
}

async function failJob(
  store: RepositoryStore,
  payload: IndexJobPayload,
  stage: string,
  error: unknown,
  snapshotId?: string,
): Promise<void> {
  const { code, message } = asErrorCode(error);
  logSafe({
    event: 'failed',
    repository_id: payload.repositoryId,
    job_id: payload.jobId,
    snapshot_id: snapshotId ?? null,
    stage,
    error_code: code,
  });
  await store.updateJob(payload.jobId, {
    status: 'FAILED',
    stage,
    errorCode: code,
    errorMessage: message,
    completedAt: new Date(),
    progress: { message },
  });
  await store.updateRepository(payload.repositoryId, { status: 'FAILED' });
  if (snapshotId) {
    const snapshot = await store.getSnapshot(snapshotId);
    if (snapshot) {
      await store.upsertSnapshot({
        repositoryId: payload.repositoryId,
        commitSha: snapshot.commitSha,
        branch: snapshot.branch,
        status: 'FAILED',
        errorMessage: message,
        completedAt: new Date(),
      });
    }
  }
}

async function readIndexedText(
  rootReal: string,
  relative: string,
  expectedSha: string | null,
  maxBytes: number,
): Promise<string | null> {
  const absolute = path.resolve(rootReal, relative);
  if (!isInsideRoot(rootReal, absolute)) return null;
  try {
    const stats = await lstat(absolute);
    if (!stats.isFile() || stats.size > maxBytes) return null;
    const resolved = await realpath(absolute);
    if (!isInsideRoot(rootReal, resolved)) return null;
    const bytes = await readFile(absolute);
    if (bytes.length > maxBytes) return null;
    if (bytes.includes(0)) return null;
    if (expectedSha && createHash('sha256').update(bytes).digest('hex') !== expectedSha)
      return null;
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Clone, scan, parse bounded source, and persist a source-backed snapshot. */
export async function processIndexJob(
  payload: IndexJobPayload,
  deps: ProcessIndexJobDeps,
): Promise<void> {
  const limits = getIngestionLimits(deps.env ?? {});
  const repository = await deps.store.getById(payload.repositoryId);
  const job = await deps.store.getJob(payload.jobId);
  if (!repository || !job) {
    throw new Error('Index job or repository is missing.');
  }
  const repositoryId = repository.id;

  await deps.store.updateJob(payload.jobId, {
    status: 'CLONING',
    stage: 'CLONING',
    startedAt: new Date(),
    progress: { message: 'Cloning repository (read-only git).' },
  });
  await deps.store.updateRepository(payload.repositoryId, { status: 'CLONING' });

  const destDir = await mkdtemp(path.join(os.tmpdir(), 'archaeologist-clone-'));
  let snapshotId: string | undefined;

  try {
    if (deps.embeddingProvider && deps.embeddingProvider.dimensions !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Configured embedding provider must return ${EMBEDDING_DIMENSIONS} dimensions.`,
      );
    }
    logSafe({
      event: 'cloning',
      repository_id: payload.repositoryId,
      job_id: payload.jobId,
      github_owner: repository.githubOwner,
      github_repo: repository.githubRepo,
    });

    let defaultBranch = repository.defaultBranch;
    if (deps.github) {
      const meta = await deps.github.getRepository(repository.githubOwner, repository.githubRepo);
      assertPublicSize(meta.sizeKb, limits.maxRepositorySizeMb);
      defaultBranch = meta.defaultBranch;
      await deps.store.updateRepository(payload.repositoryId, {
        defaultBranch: meta.defaultBranch,
        description: meta.description,
        stars: meta.stars,
        forks: meta.forks,
        language: meta.language,
      });
    }

    const cloned = await deps.clone({
      owner: repository.githubOwner,
      repo: repository.githubRepo,
      destDir,
      timeoutMs: limits.cloneTimeoutMs,
      branch: defaultBranch ?? undefined,
    });

    const snapshot = await deps.store.upsertSnapshot({
      repositoryId: repository.id,
      commitSha: cloned.commitSha,
      branch: cloned.branch,
      status: 'SCANNING',
      startedAt: new Date(),
    });
    snapshotId = snapshot.id;

    await deps.store.updateJob(payload.jobId, {
      status: 'SCANNING',
      stage: 'SCANNING',
      snapshotId: snapshot.id,
      progress: { message: 'Scanning files.' },
    });

    const scan = await deps.scan(cloned.destDir, limits);

    const indexedFiles = scan.files.filter((file) => !file.skipped);
    const sourceRoot = await realpath(cloned.destDir);
    await deps.store.updateJob(payload.jobId, {
      status: 'PARSING',
      stage: 'PARSING',
      progress: {
        message: 'Extracting source symbols, chunks, and imports.',
        filesIndexed: indexedFiles.length,
      },
    });
    await deps.store.updateRepository(payload.repositoryId, { status: 'PARSING' });
    async function* analyzedFiles() {
      for (const file of indexedFiles) {
        const content = await readIndexedText(
          sourceRoot,
          file.path,
          file.sha,
          limits.maxFileSizeBytes,
        );
        const analysis =
          content === null
            ? { symbols: [], chunks: [], imports: [] }
            : analyzeSource(file.path, content);
        yield {
          repositoryId,
          snapshotId: snapshot.id,
          path: file.path,
          language: file.language,
          sizeBytes: file.sizeBytes,
          sha: file.sha,
          content,
          isBinary: file.isBinary,
          isGenerated: file.isGenerated,
          ...analysis,
        };
      }
    }
    await deps.store.updateJob(payload.jobId, {
      status: 'ANALYZING',
      stage: 'ANALYZING',
      progress: {
        message: 'Saving searchable source and dependency facts.',
        filesIndexed: indexedFiles.length,
      },
    });
    await deps.store.replaceSnapshotFiles(snapshot.id, analyzedFiles());

    let chunksEmbedded = 0;
    const totalChunks = await deps.store.countChunks(snapshot.id);
    const embeddingSkipped = Boolean(
      deps.embeddingProvider && totalChunks > limits.maxEmbeddingChunks,
    );
    if (deps.embeddingProvider && !embeddingSkipped) {
      await deps.store.updateJob(payload.jobId, {
        status: 'EMBEDDING',
        stage: 'EMBEDDING',
        progress: {
          message: 'Generating source embeddings.',
          filesIndexed: indexedFiles.length,
          chunksEmbedded,
        },
      });
      await deps.store.updateRepository(payload.repositoryId, { status: 'EMBEDDING' });
      let afterId: string | null = null;
      const embeddingStartedAt = Date.now();
      for (;;) {
        if (Date.now() - embeddingStartedAt > limits.embeddingTimeoutMs) {
          throw new IngestionError('INDEX_TIMEOUT', 'Embedding the repository timed out.');
        }
        const batch = await deps.store.getChunksForEmbedding(snapshot.id, afterId, 8);
        if (batch.length === 0) break;
        const vectors = await embedChunks(
          deps.embeddingProvider,
          batch.map((chunk) => chunk.content),
        );
        await deps.store.updateChunkEmbeddings(
          snapshot.id,
          deps.embeddingProvider.model,
          batch.map((chunk, index) => ({ id: chunk.id, embedding: vectors[index] ?? [] })),
        );
        chunksEmbedded += batch.length;
        afterId = batch[batch.length - 1]?.id ?? null;
        await deps.store.updateJob(payload.jobId, {
          progress: {
            message: 'Generating source embeddings.',
            filesIndexed: indexedFiles.length,
            chunksEmbedded,
          },
        });
      }
    }

    await deps.store.updateJob(payload.jobId, {
      status: 'FINALIZING',
      stage: 'FINALIZING',
      progress: {
        message: 'Saving searchable source index.',
        filesIndexed: scan.filesIndexed,
        chunksEmbedded,
        filesSkipped: scan.filesSkipped,
        filesSeen: scan.filesSeen,
        skippedReasons: scan.skippedReasons,
      },
    });
    await deps.store.updateRepository(payload.repositoryId, { status: 'FINALIZING' });

    await deps.store.upsertSnapshot({
      repositoryId: repository.id,
      commitSha: cloned.commitSha,
      branch: cloned.branch,
      status: 'READY',
      completedAt: new Date(),
    });

    await deps.store.updateJob(payload.jobId, {
      status: 'READY',
      stage: 'READY',
      completedAt: new Date(),
      errorCode: null,
      errorMessage: null,
      progress: {
        message: embeddingSkipped
          ? `Indexed ${scan.filesIndexed} files. Keyword search ready; semantic indexing exceeded the configured chunk limit.`
          : `Indexed ${scan.filesIndexed} files. ${chunksEmbedded > 0 ? 'Semantic and keyword' : 'Keyword'} search ready.`,
        filesIndexed: scan.filesIndexed,
        chunksEmbedded,
        filesSkipped: scan.filesSkipped,
        filesSeen: scan.filesSeen,
        skippedReasons: scan.skippedReasons,
      },
    });
    await deps.store.updateRepository(payload.repositoryId, {
      status: 'READY',
      defaultBranch: cloned.branch,
      lastIndexedAt: new Date(),
    });

    logSafe({
      event: 'ready',
      repository_id: payload.repositoryId,
      job_id: payload.jobId,
      snapshot_id: snapshot.id,
      files_indexed: scan.filesIndexed,
      files_skipped: scan.filesSkipped,
    });
  } catch (error) {
    const stage = (await deps.store.getJob(payload.jobId))?.stage ?? 'CLONING';
    await failJob(deps.store, payload, stage, error, snapshotId);
    throw error;
  } finally {
    await rm(destDir, { recursive: true, force: true });
  }
}

/** Test helper: clone a local git directory using the same git flags as production. */
export async function processLocalFixture(
  payload: IndexJobPayload,
  store: RepositoryStore,
  sourceGitDir: string,
  embeddingProvider?: EmbeddingProvider,
  env?: Record<string, string | undefined>,
): Promise<void> {
  await processIndexJob(payload, {
    store,
    clone: async (options) => {
      const cloned = await cloneGitRemote({
        remoteUrl: sourceGitDir,
        destDir: options.destDir,
        timeoutMs: options.timeoutMs,
        branch: options.branch,
        allowFileProtocol: true,
      });
      return {
        owner: options.owner,
        repo: options.repo,
        canonicalUrl: `https://github.com/${options.owner}/${options.repo}`,
        cloneUrl: `https://github.com/${options.owner}/${options.repo}.git`,
        ...cloned,
      };
    },
    scan: scanRepositoryTree,
    embeddingProvider,
    env,
  });
}
