-- Index job progress (file counts, skip reasons, human-readable stage message).

ALTER TABLE index_jobs
  ADD COLUMN IF NOT EXISTS progress_json jsonb;
