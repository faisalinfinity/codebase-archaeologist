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

### Milestone 1 mapping

| Spec box                      | Implementation                                     |
| ----------------------------- | -------------------------------------------------- |
| Next.js web app               | `apps/web`                                         |
| API / AI gateway              | `packages/api` invoked from Next.js route handlers |
| PostgreSQL + pgvector         | `packages/db` schema + SQL migrations              |
| Redis / BullMQ / index worker | Compose service only; worker app not started       |
| Tree-sitter, embeddings, chat | Not implemented                                    |

Route handlers must not contain business rules. Services in `packages/api` must not import `next/*`, so a later Fastify (or NestJS) process can host the same layer.

## Repository lifecycle (later milestones)

```text
Submit GitHub URL → validate/normalize → create or reuse repository
  → queue index job → snapshot at commit SHA → clone (read-only git)
  → scan + ignore rules → parse symbols/deps → index docs/config
  → commits + public PRs/issues → AST chunks → embeddings
  → persist → mark snapshot READY
```

Any stage can fail. Jobs are idempotent on `(repository_id, snapshot_id)`. Retry must not duplicate chunks.

Job stages: `PENDING → CLONING → SCANNING → PARSING → ANALYZING → GITHUB_SYNC → CHUNKING → EMBEDDING → FINALIZING → READY` (or `FAILED`).

Repository status (UI): `PENDING`, `CLONING`, `PARSING`, `EMBEDDING`, `FINALIZING`, `READY`, `FAILED`, `STALE`.

## Data

See [DATABASE.md](./DATABASE.md). Core tables for Milestone 1: `users`, `repositories`, `index_jobs`. Remaining tables are sketched so ingestion/RAG can land without a rewrite.

## AuthN / AuthZ

Supabase Auth issues a session cookie. Next.js middleware gates `/dashboard` and `/repositories`. API helpers call `requireUser()` then load rows **by `owner_user_id`**. IDs from the client are never trusted without an ownership check.

## AI providers (later)

Application code depends on interfaces (`AIProvider`, `EmbeddingProvider`), not a single vendor SDK. Demo AI reads `DEMO_AI_API_KEY` on the server. BYOK is encrypted at rest (`ENCRYPTION_KEY` server-side). Custom OpenAI-compatible base URLs need SSRF controls before they are enabled.

## Frontend surfaces (planned)

| Route                                | Purpose                                  |
| ------------------------------------ | ---------------------------------------- |
| `/`                                  | Landing; GitHub URL as the primary input |
| `/login`                             | Auth                                     |
| `/dashboard`                         | Repository list                          |
| `/repositories/new`                  | Add repository                           |
| `/repositories/[id]`                 | Overview                                 |
| `/repositories/[id]/chat`            | Repository-aware chat                    |
| `/repositories/[id]/files/[...path]` | Code viewer                              |
| `/repositories/[id]/history`         | Commits                                  |
| `/repositories/[id]/dependencies`    | Graph                                    |
| `/settings/ai`                       | Providers / BYOK                         |

Milestone 1 implements `/`, `/login`, `/auth/callback`, `/dashboard`, `/repositories/new`, `/repositories/[id]`, plus `/api/health` and `/api/repositories`.

## CI / deploy

GitHub Actions runs lint, typecheck, tests, and `next build` on pull requests. Vercel is the intended host for `apps/web`. Index workers must **not** assume Vercel serverless timeouts; they deploy separately (Railway, Fly, Render, AWS, etc.) with CPU/memory/timeouts.

## Local dependencies

`docker-compose.yml` provides Postgres 16 + pgvector and Redis 7. Auth still needs a Supabase project (or compatible JWT issuer) because session cookies come from Supabase Auth.
