import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { GitHubRepositoryReader, RepositoryStore } from '@archaeologist/api';
import { assertPublicSize, HttpError } from '@archaeologist/api';
import {
  cloneGitRemote,
  IngestionError,
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
    message: 'Indexing failed while cloning or scanning the repository.',
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

/**
 * Milestone 2 processor: clone (read-only git) → scan → snapshot + files → READY.
 * Later stages (parse, embed, GitHub sync) are intentionally skipped.
 */
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
    await deps.store.replaceSnapshotFiles(
      snapshot.id,
      indexedFiles.map((file) => ({
        repositoryId: repository.id,
        snapshotId: snapshot.id,
        path: file.path,
        language: file.language,
        sizeBytes: file.sizeBytes,
        sha: file.sha,
        isBinary: file.isBinary,
        isGenerated: file.isGenerated,
      })),
    );

    await deps.store.updateJob(payload.jobId, {
      status: 'FINALIZING',
      stage: 'FINALIZING',
      progress: {
        message: 'Saving snapshot. Parsing and embeddings are not part of Milestone 2.',
        filesIndexed: scan.filesIndexed,
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
        message: `Indexed ${scan.filesIndexed} files. Skipped ${scan.filesSkipped}.`,
        filesIndexed: scan.filesIndexed,
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
  });
}
