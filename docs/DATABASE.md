# Database

PostgreSQL with the `vector` extension (pgvector). Schema is defined in Drizzle (`packages/db/src/schema.ts`) and applied as ordered SQL in `packages/db/migrations`.

Do not mutate production tables by hand. Every change is a migration.

## Apply locally

```bash
docker compose up -d
export DATABASE_URL=postgresql://archaeologist:archaeologist@localhost:5432/archaeologist
pnpm db:migrate
```

`DATABASE_URL` must point at a database where the connecting role can create extensions (or `vector` is already enabled).

## Core tables (Milestone 2)

### `users`

Application profile keyed by the Supabase Auth user UUID (`id`). Upserted on authenticated API access so local Postgres does not require `auth` schema triggers.

### `repositories`

One row per `(owner_user_id, github_owner, github_repo)`. Status enum matches the product lifecycle (`PENDING` … `READY` / `FAILED` / `STALE`). Creating a row also inserts an `index_jobs` row and enqueues BullMQ when Redis is configured.

### `index_jobs`

Job state machine including `stage`, `error_code`, `error_message`, `retry_count`, `progress_json`, and timestamps. `snapshot_id` is set once the clone SHA is known.

### `repository_snapshots`

Exact commit SHA + branch of an index. Unique on `(repository_id, commit_sha)` so retries are idempotent.

### `files`

Path, language, size, SHA, binary/generated flags, and bounded UTF-8 source content per snapshot. Phase 3 writes source text for accepted files and records chunks, TypeScript/JavaScript symbols, and file-level import edges. Files with invalid UTF-8 retain metadata but have no source text.

## Intelligence and future tables

Phase 3 writes `code_symbols`, `code_chunks`, `documents`, and import relationships in `dependencies`. Phase 4 adds embeddings to `code_chunks`. The remaining tables have no writers.

| Table                                  | Purpose                                            |
| -------------------------------------- | -------------------------------------------------- |
| `repository_members`                   | Future sharing; MVP is owner-only                  |
| `code_symbols`                         | TypeScript/JavaScript declarations and methods     |
| `code_chunks`                          | Bounded, line-aware text + optional embedding      |
| `documents`                            | Markdown and key configuration source text         |
| `commits` / `commit_files`             | History (`author_email_hash`, not raw email in UI) |
| `pull_requests` / `pull_request_files` | Public PR metadata                                 |
| `issues` / `issue_comments`            | Public issue metadata                              |
| `dependencies`                         | File imports now; other graph edges later          |
| `chat_sessions` / `chat_messages`      | Chat (no raw API keys)                             |
| `api_keys`                             | Encrypted BYOK material                            |
| `ai_provider_configs`                  | Provider/model/base URL per user                   |
| `usage_events`                         | Token/cost telemetry                               |

Phase 4 uses `code_chunks.embedding` with `vector(1536)` and records `embedding_model`. A GIN index supports keyword search and an HNSW index supports cosine search. The width is still a schema choice, not a permanent provider contract; see `DECISIONS.md`.

## Row Level Security

Generic migrations do **not** enable Supabase RLS (`auth.uid()` is not present on vanilla Postgres). After pointing at Supabase, review and apply `packages/db/supabase/rls.sql` in the Supabase SQL editor or a Supabase-specific pipeline. Application-level ownership checks are always required.
