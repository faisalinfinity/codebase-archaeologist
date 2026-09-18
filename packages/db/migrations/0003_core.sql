-- Core tables required for Milestone 1 (users, repositories, index_jobs)
-- plus snapshots so index_jobs.snapshot_id can exist as a real FK.

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE repositories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  github_owner text NOT NULL,
  github_repo text NOT NULL,
  github_url text NOT NULL,
  default_branch text,
  description text,
  stars integer,
  forks integer,
  language text,
  status repository_status NOT NULL DEFAULT 'PENDING',
  last_indexed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX repositories_owner_github_uidx
  ON repositories (owner_user_id, github_owner, github_repo);

CREATE INDEX repositories_owner_idx ON repositories (owner_user_id);

CREATE TABLE repository_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX repository_members_repo_user_uidx
  ON repository_members (repository_id, user_id);

CREATE TABLE repository_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  commit_sha text NOT NULL,
  branch text NOT NULL,
  index_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'PENDING',
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX repository_snapshots_repo_idx ON repository_snapshots (repository_id);

CREATE UNIQUE INDEX repository_snapshots_repo_sha_uidx
  ON repository_snapshots (repository_id, commit_sha);

CREATE TABLE index_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  snapshot_id uuid REFERENCES repository_snapshots (id) ON DELETE SET NULL,
  job_type index_job_type NOT NULL DEFAULT 'repository:index',
  status index_job_stage NOT NULL DEFAULT 'PENDING',
  stage index_job_stage NOT NULL DEFAULT 'PENDING',
  error_code text,
  error_message text,
  retry_count integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX index_jobs_repository_idx ON index_jobs (repository_id);
CREATE INDEX index_jobs_status_idx ON index_jobs (status);
