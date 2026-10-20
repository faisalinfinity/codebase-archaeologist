import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { expect, it } from 'vitest';

const testWithDatabase = process.env.TEST_DATABASE_URL ? it : it.skip;
testWithDatabase(
  'database policies isolate source, history, chat, and provider records',
  async () => {
    const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
    const alice = randomUUID();
    const bob = randomUUID();
    const repo = randomUUID();
    const snapshot = randomUUID();
    const file = randomUUID();
    const session = randomUUID();
    const role = `rls_${randomUUID().replaceAll('-', '')}`;
    try {
      // Keep policy application and test-only auth shim transactional. Production SQL is unchanged.
      await sql
        .begin(async (tx) => {
          await tx.unsafe(
            `CREATE SCHEMA IF NOT EXISTS auth; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; CREATE ROLE ${role} NOLOGIN; GRANT USAGE ON SCHEMA public, auth TO ${role}; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role};`,
          );
          await tx.unsafe(
            await readFile(new URL('../../../db/supabase/rls.sql', import.meta.url), 'utf8'),
          );
          await tx`INSERT INTO users (id,email) VALUES (${alice},'alice@localhost'), (${bob},'bob@localhost')`;
          await tx`INSERT INTO repositories (id,owner_user_id,github_owner,github_repo,github_url) VALUES (${repo},${alice},'test','rls','https://github.com/test/rls')`;
          await tx`INSERT INTO repository_snapshots (id,repository_id,commit_sha,branch,status) VALUES (${snapshot},${repo},'abc','main','READY')`;
          await tx`INSERT INTO files (id,repository_id,snapshot_id,path,content) VALUES (${file},${repo},${snapshot},'auth.ts','private source')`;
          await tx`INSERT INTO code_chunks (repository_id,snapshot_id,file_id,chunk_type,content,start_line,end_line) VALUES (${repo},${snapshot},${file},'source','private chunk',1,1)`;
          await tx`INSERT INTO commits (repository_id,sha,message) VALUES (${repo},'abc','history')`;
          await tx`INSERT INTO chat_sessions (id,owner_user_id,repository_id) VALUES (${session},${alice},${repo})`;
          await tx`INSERT INTO chat_messages (session_id,role,content) VALUES (${session},'assistant','private answer')`;
          await tx`INSERT INTO api_keys (user_id,provider,encrypted_key) VALUES (${alice},'openai','ciphertext')`;
          await tx.unsafe(`SET LOCAL ROLE ${role}`);
          await tx`SELECT set_config('request.jwt.claim.sub', ${alice}, true)`;
          for (const table of [
            'repositories',
            'repository_snapshots',
            'files',
            'code_chunks',
            'commits',
            'chat_sessions',
            'chat_messages',
          ])
            expect((await tx.unsafe(`SELECT * FROM ${table}`)).length).toBeGreaterThan(0);
          expect(await tx`SELECT * FROM api_keys`).toHaveLength(0);
          await tx`SELECT set_config('request.jwt.claim.sub', ${bob}, true)`;
          for (const table of [
            'repositories',
            'repository_snapshots',
            'files',
            'code_chunks',
            'commits',
            'chat_sessions',
            'chat_messages',
            'api_keys',
          ])
            expect(await tx.unsafe(`SELECT * FROM ${table}`)).toHaveLength(0);
          await tx.unsafe('RESET ROLE');
          // Deliberate rollback also removes policies, shim, fixtures, and temporary role.
          throw new Error('rollback-verified');
        })
        .catch((error: unknown) => {
          if (!(error instanceof Error) || error.message !== 'rollback-verified') throw error;
        });
    } finally {
      await sql.end();
    }
  },
);
