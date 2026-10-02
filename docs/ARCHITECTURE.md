# Architecture

Codebase Archaeologist is five cooperating systems, not a chat box on a vector store:

```text
             CODEBASE ARCHAEOLOGIST

       +-----------------------------+
       |       Developer UI          |
       +--------------+--------------+
                      |
       +--------------v--------------+
       |        RAG Orchestrator     |
       +--------------+--------------+
                      |
      +---------------+----------------+
      |               |                |
      v               v                v
   CODE RAG       GIT HISTORY      CODE GRAPH
      |               |                |
      +---------------+----------------+
                      |
                      v
               EVIDENCE CONTEXT
                      |
                      v
                AI PROVIDER
                      |
                      v
              ANSWER + CITATIONS
```

Competitive value is the **join** across code, history, and graph.

## Runtime topology

```text
                         USER
                          |
                          v
                 +-------------------+
                 |      Next.js      |
                 |     Web App       |
                 +---------+---------+
                           |
                     HTTPS / SSE
                           |
                           v
                 +-------------------+
                 | API / AI Gateway  |
                 | Auth              |
                 | Repo management   |
                 | Chat orchestration|
                 | AI provider router|
                 | Usage / limits    |
                 +---------+---------+
                           |
             +-------------+---------------+
             |             |               |
             v             v               v
       PostgreSQL        Redis         Object Storage
       + pgvector       BullMQ          (optional)
             |             |
             |             v
             |      +--------------+
             |      | Index Worker  |
             |      +------+-------+
             |             |
             |      Git, GitHub API, Tree-sitter, graphs
             |             |
             +-------------+
                           v
                    Embeddings / hybrid retrieval
                           v
                    Context builder → provider router
                           v
                    Answer + citations
```

### Milestone 2 mapping

| Spec box                      | Implementation                                             |
| ----------------------------- | ---------------------------------------------------------- |
| Next.js web app               | `apps/web`                                                 |
| API / AI gateway              | `packages/api` invoked from Next.js route handlers         |
| PostgreSQL + pgvector         | `packages/db` schema + SQL migrations                      |
| Redis / BullMQ / index worker | `apps/worker` + Compose Redis; enqueue from `packages/api` |
| Clone + file scan             | `packages/ingestion` (read-only git, ignore rules, limits) |
| Source parsing / retrieval    | TypeScript/JavaScript parsing and indexed keyword search   |
| Optional embeddings           | Server-side provider and pgvector cosine search            |
| Chat / history intelligence   | Not implemented                                            |

Route handlers must not contain business rules. Services in `packages/api` must not import `next/*`, so a later Fastify (or NestJS) process can host the same layer.

## Repository lifecycle (Milestone 2)

```text
Submit GitHub URL → validate/normalize → GitHub metadata → create or reuse repository
  → queue index job → clone (read-only git) → snapshot at commit SHA
  → scan + ignore rules → persist files → mark snapshot READY
```

GitHub issue/PR sync and AI answers are later stages. Jobs are idempotent on `(repository_id, snapshot_id)` (unique snapshot SHA; file rows replaced per snapshot).

Job stages implemented now: `PENDING → CLONING → SCANNING → PARSING → ANALYZING → [EMBEDDING] → FINALIZING → READY` (or `FAILED`).

Repository status (UI): `PENDING`, `CLONING`, `PARSING`, optional `EMBEDDING`, `FINALIZING`, `READY`, `FAILED` (`STALE` is reserved for later updates).

## Data

See [DATABASE.md](./DATABASE.md). Core tables: `users`, `repositories`, `index_jobs`, `repository_snapshots`, `files`. Remaining tables are sketched so RAG can land without a rewrite.

Index job progress is stored in `index_jobs.progress_json`. The Phase 3 slice stores bounded source text and TypeScript/JavaScript syntax facts in the existing intelligence tables. See [INDEXING.md](./INDEXING.md).

Phase 4 adds PostgreSQL full-text search over chunks. When a server-side embedding key is configured, the worker stores 1,536-dimensional vectors and the repository search service merges full-text and cosine-similarity results. The search API remains owner-scoped and returns commit-pinned source links.

## AuthN / AuthZ

Supabase Auth issues a session cookie. Next.js middleware gates `/dashboard` and `/repositories`. API helpers call `requireUser()` then load rows **by `owner_user_id`**. IDs from the client are never trusted without an ownership check.

## AI providers

Phase 4 uses an `EmbeddingProvider` interface with an optional server-side OpenAI adapter. `AIProvider`, Demo AI, BYOK encryption, and custom compatible endpoints are later work. Custom base URLs need SSRF controls before they are enabled.

## Frontend surfaces (planned)

| Route                                | Purpose                                  |
| ------------------------------------ | ---------------------------------------- |
| `/`                                  | Landing; GitHub URL as the primary input |
| `/login`                             | Auth                                     |
| `/dashboard`                         | Repository list                          |
| `/repositories/new`                  | Add repository                           |
| `/repositories/[id]`                 | Overview                                 |
| `/repositories/[id]/search`          | Source retrieval                         |
| `/repositories/[id]/chat`            | Repository-aware chat (later)            |
| `/repositories/[id]/files/[...path]` | Code viewer                              |
| `/repositories/[id]/history`         | Commits                                  |
| `/repositories/[id]/dependencies`    | Graph                                    |
| `/settings/ai`                       | Providers / BYOK                         |

Milestone 1 implements `/`, `/login`, `/auth/callback`, `/dashboard`, `/repositories/new`, `/repositories/[id]`, plus `/api/health` and `/api/repositories`.

Milestone 2 adds `GET/POST /api/repositories/:id/index` and `GET /api/repositories/:id/index/status`, and live progress on the repository overview.

Phases 3–4 add source browsing, `GET /api/repositories/:id/search`, and indexed retrieval.

## CI / deploy

GitHub Actions runs lint, typecheck, tests, and `next build` on pull requests. Vercel is the intended host for `apps/web`. Index workers must **not** assume Vercel serverless timeouts; they deploy separately (Railway, Fly, Render, AWS, etc.) with CPU/memory/timeouts.

## Local dependencies

`docker-compose.yml` provides Postgres 16 + pgvector and Redis 7. Auth still needs a Supabase project (or compatible JWT issuer) because session cookies come from Supabase Auth.
