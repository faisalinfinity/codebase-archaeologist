CREATE TYPE repository_status AS ENUM (
  'PENDING',
  'CLONING',
  'PARSING',
  'EMBEDDING',
  'FINALIZING',
  'READY',
  'FAILED',
  'STALE'
);

CREATE TYPE index_job_stage AS ENUM (
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
  'FAILED'
);

CREATE TYPE index_job_type AS ENUM (
  'repository:index',
  'repository:update',
  'repository:github-sync',
  'repository:embed',
  'repository:finalize'
);
