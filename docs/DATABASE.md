# Database

PostgreSQL with the `vector` extension (pgvector). Schema is defined in Drizzle (`packages/db/src/schema.ts`) and applied as ordered SQL in `packages/db/migrations`.

Do not mutate production tables by hand. Every change is a migration.

## Apply locally

```bash
docker compose up -d
pnpm db:migrate
```

`DATABASE_URL` must point at a database where the connecting role can create extensions (or `vector` is already enabled).

## Core tables (Milestone 1)

### `users`

Application profile keyed by the Supabase Auth user UUID (`id`). Upserted on authenticated API access so local Postgres does not require `auth` schema triggers.

### `repositories`

One row per `(owner_user_id, github_owner, github_repo)`. Status enum matches the product lifecycle (`PENDING` … `READY` / `FAILED` / `STALE`). No clone happens in Milestone 1; creating a row also inserts an `index_jobs` stub.

### `index_jobs`

Job state machine including `stage`, `error_code`, `error_message`, `retry_count`, and timestamps. `snapshot_id` is nullable until snapshots exist.

## Sketched tables (created, unused)

These exist so later milestones do not start from a blank schema. Writers are not implemented.

| Table                                  | Purpose                                            |
| -------------------------------------- | -------------------------------------------------- |
| `repository_members`                   | Future sharing; MVP is owner-only                  |
| `repository_snapshots`                 | Exact commit SHA of an index                       |
| `files`                                | Path, language, size, SHA, binary/generated flags  |
| `code_symbols`                         | AST symbols with parent/child                      |
| `code_chunks`                          | Chunk text + `vector(1536)` embedding placeholder  |
| `documents`                            | README/docs/config chunks + embedding              |
| `commits` / `commit_files`             | History (`author_email_hash`, not raw email in UI) |
| `pull_requests` / `pull_request_files` | Public PR metadata                                 |
| `issues` / `issue_comments`            | Public issue metadata                              |
| `dependencies`                         | Graph edges (`imports`, `calls`, `extends`, …)     |
| `chat_sessions` / `chat_messages`      | Chat (no raw API keys)                             |
| `api_keys`                             | Encrypted BYOK material                            |
| `ai_provider_configs`                  | Provider/model/base URL per user                   |
| `usage_events`                         | Token/cost telemetry                               |

Embedding width `1536` is a placeholder; see `DECISIONS.md`.

## Row Level Security

Generic migrations do **not** enable Supabase RLS (`auth.uid()` is not present on vanilla Postgres). After pointing at Supabase, review and apply `packages/db/supabase/rls.sql` in the Supabase SQL editor or a Supabase-specific pipeline. Application-level ownership checks are always required.
