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

Phase 3 writes `code_symbols`, `code_chunks`, `documents`, and import relationships in `dependencies`. Phase 4 adds embeddings to `code_chunks`. Phase 5 writes `chat_sessions`, `chat_messages`, and token counts in `usage_events`. Phase 6 writes recent `commits`, `commit_files`, `pull_requests`, and `issues`; Phase 7 writes `pull_request_files`, issue file-link metadata, encrypted personal keys, provider configs, and atomic request counters; `issue_comments` still has no writer.

| Table                                  | Purpose                                            |
| -------------------------------------- | -------------------------------------------------- |
| `repository_members`                   | Future sharing; MVP is owner-only                  |
| `code_symbols`                         | Declarations across supported source grammars      |
| `code_chunks`                          | Bounded, line-aware text + optional embedding      |
| `documents`                            | Markdown and key configuration source text         |
| `commits` / `commit_files`             | Recent messages and changed paths; no email stored |
| `pull_requests` / `pull_request_files` | Recent PR summaries and bounded changed paths      |
| `issues` / `issue_comments`            | Recent issue summaries; comments later             |
| `dependencies`                         | File imports and resolved symbol reference edges   |
| `chat_sessions` / `chat_messages`      | Owner-scoped completed chat turns                  |
| `api_keys`                             | Encrypted BYOK material                            |
| `ai_provider_configs`                  | Provider/model/base URL per user                   |
| `usage_events`                         | Chat token telemetry; cost calculation later       |

Phase 4 uses `code_chunks.embedding` with `vector(1536)` and records `embedding_model`. A GIN index supports keyword search and an HNSW index supports cosine search. The width is still a schema choice, not a permanent provider contract; see `DECISIONS.md`.

## Row Level Security

Generic migrations do **not** enable Supabase RLS (`auth.uid()` is not present on vanilla Postgres). After pointing at Supabase, review and apply `packages/db/supabase/rls.sql` in the Supabase SQL editor or a Supabase-specific pipeline. Application-level ownership checks are always required.

## Personal providers and request limits

Migration 0011 adds one active provider config/key per user. `api_keys.encrypted_key` stores versioned authenticated ciphertext; plaintext keys exist only during submission and server-side provider construction. Migration 0012 creates the server-only `request_limits` table, keyed by `(user_id, action)`, with atomic hourly counters.

Index-job creation locks the repository row and reuses an active job to serialize concurrent re-index requests. Pending jobs can be safely re-enqueued using BullMQ's stable job ID after Redis becomes available. Use `DIRECT_DATABASE_URL` for migrations when supplied; runtime traffic uses `DATABASE_URL`.
