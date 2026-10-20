CREATE TABLE request_limits (
  user_id uuid NOT NULL,
  action text NOT NULL,
  bucket timestamptz NOT NULL,
  requests bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, action)
);
ALTER TABLE request_limits ENABLE ROW LEVEL SECURITY;
-- Server-only counters: no client grants or policies.
