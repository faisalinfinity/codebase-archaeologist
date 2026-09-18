import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { ServiceUnavailableError } from '../errors';
import {
  INDEX_JOB_NAME,
  INDEX_QUEUE_NAME,
  type IndexJobPayload,
  type IndexJobQueue,
} from './index-queue';

let cachedConnection: IORedis | null = null;
let cachedQueue: Queue<IndexJobPayload> | null = null;

function getRedis(url: string): IORedis {
  if (!cachedConnection) {
    cachedConnection = new IORedis(url, { maxRetriesPerRequest: null });
  }
  return cachedConnection;
}

export function getIndexQueue(redisUrl: string): Queue<IndexJobPayload> {
  if (!cachedQueue) {
    cachedQueue = new Queue<IndexJobPayload>(INDEX_QUEUE_NAME, {
      connection: getRedis(redisUrl),
    });
  }
  return cachedQueue;
}

export class BullmqIndexQueue implements IndexJobQueue {
  constructor(private readonly redisUrl: string) {}

  async enqueueIndex(payload: IndexJobPayload): Promise<void> {
    try {
      const queue = getIndexQueue(this.redisUrl);
      await queue.add(INDEX_JOB_NAME, payload, {
        jobId: payload.jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 1_000,
        removeOnFail: 1_000,
      });
    } catch (error) {
      console.error('[queue]', error instanceof Error ? error.message : 'enqueue_failed');
      throw new ServiceUnavailableError(
        'The index queue is unavailable. Start Redis and retry.',
        'REDIS_UNAVAILABLE',
      );
    }
  }
}
