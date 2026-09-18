-- Chat, BYOK material, provider config, and usage (sketched; no writers in Milestone 1).
-- api_keys.encrypted_key is ciphertext only. Never store plaintext provider keys.

CREATE TABLE chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  repository_id uuid NOT NULL REFERENCES repositories (id) ON DELETE CASCADE,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_sessions_owner_idx ON chat_sessions (owner_user_id);
CREATE INDEX chat_sessions_repo_idx ON chat_sessions (repository_id);

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES chat_sessions (id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  provider text,
  model text,
  token_usage integer,
  retrieval_metadata_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_messages_session_idx ON chat_messages (session_id);

CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider text NOT NULL,
  encrypted_key text NOT NULL,
  key_last_four text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX api_keys_user_idx ON api_keys (user_id);

CREATE TABLE ai_provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider text NOT NULL,
  base_url text,
  model text,
  is_custom boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_provider_configs_user_idx ON ai_provider_configs (user_id);

CREATE TABLE usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  repository_id uuid REFERENCES repositories (id) ON DELETE SET NULL,
  event_type text NOT NULL,
  tokens_in integer,
  tokens_out integer,
  cost_cents integer,
  metadata_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX usage_events_user_idx ON usage_events (user_id);
