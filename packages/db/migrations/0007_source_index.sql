-- Store bounded source text and file-level imports for the first code intelligence phase.
ALTER TABLE files ADD COLUMN content text;
ALTER TABLE dependencies ADD COLUMN source_file_id uuid REFERENCES files (id) ON DELETE CASCADE;
ALTER TABLE dependencies ADD COLUMN target_file_id uuid REFERENCES files (id) ON DELETE CASCADE;
CREATE INDEX dependencies_source_file_idx ON dependencies (source_file_id);
CREATE INDEX dependencies_target_file_idx ON dependencies (target_file_id);
