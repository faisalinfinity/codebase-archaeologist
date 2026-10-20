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
| Repository chat               | Streamed answers with checked source citations             |
| Recent history and impact     | Bounded git log, public PR/issues, reverse imports         |

Route handlers must not contain business rules. Services in `packages/api` must not import `next/*`, so a later Fastify (or NestJS) process can host the same layer.

## Repository lifecycle (Milestone 2)

```text
Submit GitHub URL → validate/normalize → GitHub metadata → create or reuse repository
  → queue index job → clone (read-only git) → snapshot at commit SHA
  → scan + ignore rules → persist files → mark snapshot READY
```

GitHub issue/PR summaries and recent commits are synced in Phase 6. Jobs are idempotent on `(repository_id, snapshot_id)` (unique snapshot SHA; file rows replaced per snapshot).

Job stages implemented now: `PENDING → CLONING → SCANNING → PARSING → ANALYZING → [EMBEDDING] → GITHUB_SYNC → FINALIZING → READY` (or `FAILED`).

Repository status (UI): `PENDING`, `CLONING`, `PARSING`, optional `EMBEDDING`, `FINALIZING`, `READY`, `FAILED` (`STALE` is reserved for later updates).

## Data

See [DATABASE.md](./DATABASE.md). Core tables: `users`, `repositories`, `index_jobs`, `repository_snapshots`, `files`. Source intelligence, history, chat, and personal provider tables now have writers; team sharing and issue comments remain reserved.

Index job progress is stored in `index_jobs.progress_json`. The Phase 3 slice stores bounded source text and TypeScript/JavaScript syntax facts in the existing intelligence tables. See [INDEXING.md](./INDEXING.md).

Phase 4 adds PostgreSQL full-text search over chunks. When a server-side embedding key is configured, the worker stores 1,536-dimensional vectors and the repository search service merges full-text and cosine-similarity results. The search API remains owner-scoped and returns commit-pinned source links.

Phase 5 retrieves a bounded set of source snippets, streams a response through the server-side AI provider, resolves citation markers against those exact records, and saves completed turns in `chat_sessions` and `chat_messages`.

Phase 6 adds a bounded recent Git history window and public PR/issue metadata. The impact service walks resolved local import edges in reverse and counts recent co-changes. Chat may cite matched commits, PRs, and issues alongside source lines.

## AuthN / AuthZ

Supabase Auth issues a session cookie. Next.js middleware gates `/dashboard` and `/repositories`. API helpers call `requireUser()` then load rows **by `owner_user_id`**. IDs from the client are never trusted without an ownership check.

## AI providers

Phase 4 uses an `EmbeddingProvider` interface with an optional server-side OpenAI adapter. Phase 5 adds an `AIProvider` interface and a server-side Demo AI adapter. Phase 7 routes personal providers through encrypted settings. Approved custom origins use socket-time public-address validation and reject redirects.

## Frontend surfaces

| Route                                | Purpose                                  |
| ------------------------------------ | ---------------------------------------- |
| `/`                                  | Landing; GitHub URL as the primary input |
| `/login`                             | Auth                                     |
| `/dashboard`                         | Repository list                          |
| `/repositories/new`                  | Add repository                           |
| `/repositories/[id]`                 | Overview                                 |
| `/repositories/[id]/search`          | Source retrieval                         |
| `/repositories/[id]/chat`            | Repository-aware chat                    |
| `/repositories/[id]/files/[...path]` | Code viewer                              |
| `/repositories/[id]/history`         | Recent commits, PRs, and issues          |
| `/repositories/[id]/impact`          | Reverse imports and co-changes           |
| `/settings/ai`                       | Providers / BYOK                         |

Milestone 1 implements `/`, `/login`, `/auth/callback`, `/dashboard`, `/repositories/new`, `/repositories/[id]`, plus `/api/health` and `/api/repositories`.

Milestone 2 adds `GET/POST /api/repositories/:id/index` and `GET /api/repositories/:id/index/status`, and live progress on the repository overview.

Phases 3–4 add source browsing, `GET /api/repositories/:id/search`, and indexed retrieval.

Phase 5 adds `GET/POST /api/repositories/:id/chat` and `GET /api/repositories/:id/chat/sessions/:sessionId`.

Phase 6 adds `GET /api/repositories/:id/history` and `GET /api/repositories/:id/impact`.

## CI / deploy

GitHub Actions runs lint, typecheck, tests, and `next build` on pull requests. Vercel is the intended host for `apps/web`. Index workers must **not** assume Vercel serverless timeouts; they deploy separately (Railway, Fly, Render, AWS, etc.) with CPU/memory/timeouts.

## Local dependencies

`docker-compose.yml` provides Postgres 16 + pgvector and Redis 7. Auth still needs a Supabase project (or compatible JWT issuer) because session cookies come from Supabase Auth.

## Phase 7 release topology

Vercel hosts `apps/web`; a manually dispatched GitHub Actions run drains `apps/worker` and exits. The non-root container remains available for self-hosting. Both connect to hosted Postgres and Redis. Supabase supplies identity; API services enforce owners independently of browser navigation. Shared database counters enforce attempt limits across web instances. Settings route handlers submit keys once, encrypt them on the server, and return metadata only.

The worker uses packaged WASM grammars, without loading repository plugins. It records declarations across supported languages and conservative JavaScript/TypeScript symbol reference edges. History endpoints paginate indexed commits and filter linked PRs/issues by file. See [DEPLOYMENT.md](DEPLOYMENT.md) for configuration and verification.
