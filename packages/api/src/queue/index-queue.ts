export const INDEX_QUEUE_NAME = 'repository-index';
export const INDEX_JOB_NAME = 'repository:index';

export interface IndexJobPayload {
  repositoryId: string;
  jobId: string;
}

export interface IndexJobQueue {
  enqueueIndex(payload: IndexJobPayload): Promise<void>;
}

export class NoopIndexQueue implements IndexJobQueue {
  readonly jobs: IndexJobPayload[] = [];

  async enqueueIndex(payload: IndexJobPayload): Promise<void> {
    this.jobs.push(payload);
  }
}
