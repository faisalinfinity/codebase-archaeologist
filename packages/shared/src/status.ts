export const repositoryStatuses = [
  'PENDING',
  'CLONING',
  'PARSING',
  'EMBEDDING',
  'FINALIZING',
  'READY',
  'FAILED',
  'STALE',
] as const;

export type RepositoryStatus = (typeof repositoryStatuses)[number];

export const indexJobStages = [
  'PENDING',
  'CLONING',
  'SCANNING',
  'PARSING',
  'ANALYZING',
  'GITHUB_SYNC',
  'CHUNKING',
  'EMBEDDING',
  'FINALIZING',
  'READY',
  'FAILED',
] as const;

export type IndexJobStage = (typeof indexJobStages)[number];

export const indexJobTypes = [
  'repository:index',
  'repository:update',
  'repository:github-sync',
  'repository:embed',
  'repository:finalize',
] as const;

export type IndexJobType = (typeof indexJobTypes)[number];
