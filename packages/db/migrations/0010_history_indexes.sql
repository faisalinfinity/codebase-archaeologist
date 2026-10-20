-- Phase 6: recent history and repository context lookups.
CREATE INDEX commit_files_path_idx ON commit_files (path, commit_id);
CREATE INDEX pull_requests_repo_updated_idx ON pull_requests (repository_id, updated_at DESC);
CREATE INDEX issues_repo_updated_idx ON issues (repository_id, updated_at DESC);
