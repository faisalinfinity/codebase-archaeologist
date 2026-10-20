-- Optional: apply against a Supabase project (SQL editor or supabase db push).
-- Requires auth.uid(). Do not run on vanilla local Postgres.
-- Application-level ownership checks remain mandatory even with RLS.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE repository_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE repository_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE index_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE code_symbols ENABLE ROW LEVEL SECURITY;
ALTER TABLE code_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE commits ENABLE ROW LEVEL SECURITY;
ALTER TABLE commit_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE pull_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE pull_request_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_self ON users
  FOR ALL
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY repositories_owner ON repositories
  FOR ALL
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY repository_members_owner ON repository_members
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM repositories r
      WHERE r.id = repository_id AND r.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM repositories r
      WHERE r.id = repository_id AND r.owner_user_id = auth.uid()
    )
  );

CREATE POLICY index_jobs_owner ON index_jobs
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM repositories r
      WHERE r.id = repository_id AND r.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM repositories r
      WHERE r.id = repository_id AND r.owner_user_id = auth.uid()
    )
  );

CREATE POLICY chat_sessions_owner ON chat_sessions
  FOR ALL
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY chat_messages_owner ON chat_messages
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM chat_sessions s
      WHERE s.id = session_id AND s.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_sessions s
      WHERE s.id = session_id AND s.owner_user_id = auth.uid()
    )
  );

CREATE POLICY api_keys_owner ON api_keys
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY ai_provider_configs_owner ON ai_provider_configs
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY usage_events_owner ON usage_events
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Intelligence rows are protected through their repository owner.
DO $$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['repository_snapshots', 'files', 'code_symbols', 'code_chunks', 'documents', 'commits', 'pull_requests', 'issues', 'dependencies'] LOOP
    EXECUTE format('CREATE POLICY repository_owner ON %I FOR ALL USING (EXISTS (SELECT 1 FROM repositories r WHERE r.id = repository_id AND r.owner_user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM repositories r WHERE r.id = repository_id AND r.owner_user_id = auth.uid()))', relation_name);
  END LOOP;
END $$;

CREATE POLICY commit_files_owner ON commit_files FOR ALL
  USING (EXISTS (SELECT 1 FROM commits c JOIN repositories r ON r.id = c.repository_id WHERE c.id = commit_id AND r.owner_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM commits c JOIN repositories r ON r.id = c.repository_id WHERE c.id = commit_id AND r.owner_user_id = auth.uid()));

CREATE POLICY pull_request_files_owner ON pull_request_files FOR ALL
  USING (EXISTS (SELECT 1 FROM pull_requests p JOIN repositories r ON r.id = p.repository_id WHERE p.id = pull_request_id AND r.owner_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM pull_requests p JOIN repositories r ON r.id = p.repository_id WHERE p.id = pull_request_id AND r.owner_user_id = auth.uid()));

CREATE POLICY issue_comments_owner ON issue_comments FOR ALL
  USING (EXISTS (SELECT 1 FROM issues i JOIN repositories r ON r.id = i.repository_id WHERE i.id = issue_id AND r.owner_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM issues i JOIN repositories r ON r.id = i.repository_id WHERE i.id = issue_id AND r.owner_user_id = auth.uid()));

-- API keys are written and decrypted by the server only. Never expose even ciphertext
-- through Supabase's browser-facing API.
DROP POLICY api_keys_owner ON api_keys;
