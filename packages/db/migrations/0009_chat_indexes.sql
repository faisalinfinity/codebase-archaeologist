-- Phase 5: efficient owner-scoped session lists and per-session message history.
CREATE INDEX chat_sessions_owner_repo_updated_idx
  ON chat_sessions (owner_user_id, repository_id, updated_at DESC);
CREATE INDEX chat_messages_session_created_idx
  ON chat_messages (session_id, created_at, id);
