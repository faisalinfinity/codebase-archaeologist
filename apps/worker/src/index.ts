import { Worker } from 'bullmq';
import IORedis from 'ioredis';

import {
  DrizzleRepositoryStore,
  GitHubRepoClient,
  INDEX_JOB_NAME,
  INDEX_QUEUE_NAME,
  type IndexJobPayload,
} from '@archaeologist/api';
import { clonePublicGitHubRepo, scanRepositoryTree } from '@archaeologist/ingestion';

import { processIndexJob } from './process-index-job';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for the index worker.`);
  }
  return value;
}

async function main(): Promise<void> {
  const redisUrl = required('REDIS_URL');
  required('DATABASE_URL');

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const store = new DrizzleRepositoryStore();
  const github = new GitHubRepoClient({ token: process.env.GITHUB_API_TOKEN });
  const concurrency = Number.parseInt(process.env.WORKER_CONCURRENCY ?? '1', 10) || 1;

  const worker = new Worker<IndexJobPayload>(
    INDEX_QUEUE_NAME,
    async (job) => {
      if (job.name !== INDEX_JOB_NAME) {
        return;
      }
      console.log(
        JSON.stringify({
          msg: 'index_job',
          event: 'start',
          job_id: job.data.jobId,
          repository_id: job.data.repositoryId,
        }),
      );
      await processIndexJob(job.data, {
        store,
        clone: clonePublicGitHubRepo,
        scan: scanRepositoryTree,
        env: process.env,
        github,
      });
    },
    {
      connection,
      concurrency,
      lockDuration: 5 * 60 * 1000,
    },
  );

  worker.on('failed', (job, error) => {
    console.error(
      JSON.stringify({
        msg: 'index_job',
        event: 'worker_failed',
        job_id: job?.data.jobId ?? null,
        repository_id: job?.data.repositoryId ?? null,
        error: error.message,
      }),
    );
  });

  const shutdown = async () => {
    await worker.close();
    await connection.quit();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });

  console.log(
    JSON.stringify({
      msg: 'worker_started',
      queue: INDEX_QUEUE_NAME,
      concurrency,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
