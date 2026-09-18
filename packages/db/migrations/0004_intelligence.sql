-- Ingestion / intelligence tables (sketched; no writers in Milestone 1).

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES repository_snapshots (id) ON DELETE CASCADE,
  path text NOT NULL,
  language text,
  size_bytes integer NOT NULL DEFAULT 0,
  sha text,
  is_binary boolean NOT NULL DEFAULT false,
  is_generated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX files_snapshot_path_uidx ON files (snapshot_id, path);
CREATE INDEX files_repository_idx ON files (repository_id);

CREATE TABLE code_symbols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  repository_id uuid NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES repository_snapshots (id) ON DELETE CASCADE,
  symbol_type text NOT NULL,
  name text NOT NULL,
  qualified_name text,
  start_line integer NOT NULL,
  end_line integer NOT NULL,
  start_column integer,
  end_column integer,
  parent_symbol_id uuid REFERENCES code_symbols (id) ON DELETE SET NULL,
  signature text,
  metadata_json jsonb
);

CREATE INDEX code_symbols_file_idx ON code_symbols (file_id);
CREATE INDEX code_symbols_repo_name_idx ON code_symbols (repository_id, name);

-- embedding width 1536 is a placeholder; see DECISIONS.md
CREATE TABLE code_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES repository_snapshots (id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  symbol_id uuid REFERENCES code_symbols (id) ON DELETE SET NULL,
  chunk_type text NOT NULL,
  content text NOT NULL,
  start_line integer NOT NULL,
  end_line integer NOT NULL,
  language text,
  embedding vector(1536),
  metadata_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX code_chunks_snapshot_idx ON code_chunks (snapshot_id);
CREATE INDEX code_chunks_file_idx ON code_chunks (file_id);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES repository_snapshots (id) ON DELETE CASCADE,
  file_id uuid REFERENCES files (id) ON DELETE SET NULL,
  title text,
  content text NOT NULL,
  doc_type text NOT NULL,
  embedding vector(1536),
  metadata_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX documents_snapshot_idx ON documents (snapshot_id);

CREATE TABLE commits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  sha text NOT NULL,
  author_name text,
  author_email_hash text,
  message text NOT NULL,
  committed_at timestamptz,
  parent_sha text,
  metadata_json jsonb
);

CREATE UNIQUE INDEX commits_repo_sha_uidx ON commits (repository_id, sha);

CREATE TABLE commit_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commit_id uuid NOT NULL REFERENCES commits (id) ON DELETE CASCADE,
  path text NOT NULL,
  change_type text NOT NULL,
  metadata_json jsonb
);

CREATE INDEX commit_files_commit_idx ON commit_files (commit_id);

CREATE TABLE pull_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  number integer NOT NULL,
  title text NOT NULL,
  body text,
  author text,
  state text NOT NULL,
  created_at timestamptz,
  merged_at timestamptz,
  updated_at timestamptz,
  metadata_json jsonb
);

CREATE UNIQUE INDEX pull_requests_repo_number_uidx ON pull_requests (repository_id, number);

CREATE TABLE pull_request_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pull_request_id uuid NOT NULL REFERENCES pull_requests (id) ON DELETE CASCADE,
  path text NOT NULL,
  change_type text,
  metadata_json jsonb
);

CREATE INDEX pull_request_files_pr_idx ON pull_request_files (pull_request_id);

CREATE TABLE issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  number integer NOT NULL,
  title text NOT NULL,
  body text,
  author text,
  state text NOT NULL,
  created_at timestamptz,
  updated_at timestamptz,
  metadata_json jsonb
);

CREATE UNIQUE INDEX issues_repo_number_uidx ON issues (repository_id, number);

CREATE TABLE issue_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
  author text,
  body text NOT NULL,
  created_at timestamptz,
  metadata_json jsonb
);

CREATE INDEX issue_comments_issue_idx ON issue_comments (issue_id);

CREATE TABLE dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES repository_snapshots (id) ON DELETE CASCADE,
  source_symbol_id uuid REFERENCES code_symbols (id) ON DELETE CASCADE,
  target_symbol_id uuid REFERENCES code_symbols (id) ON DELETE CASCADE,
  relationship_type text NOT NULL,
  metadata_json jsonb
);

CREATE INDEX dependencies_snapshot_idx ON dependencies (snapshot_id);
