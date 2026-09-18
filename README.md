# Codebase Archaeologist

Understand **what** a GitHub codebase does, **why** it exists, **how** a request flows through it, **what changed** over time, and **what impact** a change could have.

This is not generic chat-with-code. Answers are grounded in indexed source, Git history, issues/PRs, and a code graph, with citations back to exact files and lines.

## Current status

**Milestone 2 — repository ingestion.** Submit a public GitHub URL, validate it, enqueue a BullMQ index job, clone with **read-only git** (never execute repository code), scan files with ignore/size/symlink guards, and persist a snapshot. Tree-sitter, embeddings, RAG, and chat are still out of scope.

## Architecture sketch

```text
                         USER
                          |
                          v
                 +-------------------+
                 |      Next.js      |
                 |     apps/web      |
                 +---------+---------+
                           |
                     HTTPS / SSE
                           |
                           v
                 +-------------------+
                 | packages/api      |
                 | Auth, repo mgmt   |
                 | GitHub metadata   |
                 | enqueue index job |
                 +---------+---------+
                           |
             +-------------+---------------+
             |             |               |
             v             v               v
       PostgreSQL        Redis         Index worker
       + pgvector       BullMQ         apps/worker
       packages/db                     packages/ingestion
```

Next.js route handlers call `packages/api`. The worker is a separate Node process. It must **never execute untrusted repository code**.

## Monorepo

| Path                 | Role                                            |
| -------------------- | ----------------------------------------------- |
| `apps/web`           | Next.js App Router UI + thin route handlers     |
| `apps/worker`        | BullMQ index worker                             |
| `packages/api`       | Domain services (auth, repositories, GitHub)    |
| `packages/db`        | Drizzle schema, SQL migrations, Postgres client |
| `packages/shared`    | Types, Zod schemas, GitHub URL, ignore rules    |
| `packages/ingestion` | Safe git clone + file scanner                   |
| `docs/`              | PRD, architecture, security, indexing           |
| `DECISIONS.md`       | Stack choices and deviations                    |

## Local setup

### Prerequisites

- Node.js 22+
- pnpm 10+ (`corepack enable`)
- Git (worker host)
- Docker (Postgres + Redis) **or** a Supabase project + Redis
- A Supabase project for Auth (email/password or magic link)

### 1. Install

```bash
pnpm install
```

### 2. Environment

```bash
cp .env.example apps/web/.env.local
```

Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Keep `DATABASE_URL` and `REDIS_URL` for local Compose.

Do **not** put `SUPABASE_SERVICE_ROLE_KEY`, `DEMO_AI_API_KEY`, `GITHUB_API_TOKEN`, or `ENCRYPTION_KEY` in any `NEXT_PUBLIC_*` variable.

### 3. Database and Redis

```bash
docker compose up -d
pnpm db:migrate
```

### 4. Auth provider (Supabase)

In the Supabase dashboard:

1. Enable Email auth (password and/or magic link).
2. Set the Site URL to `http://localhost:3000`.
3. Add redirect URL `http://localhost:3000/auth/callback`.

### 5. Run the app and worker

```bash
pnpm dev
```

In another terminal:

```bash
export DATABASE_URL=postgresql://archaeologist:archaeologist@localhost:5432/archaeologist
export REDIS_URL=redis://localhost:6379
pnpm worker
```

Open [http://localhost:3000](http://localhost:3000). Sign in at `/login`. Add `https://github.com/octocat/Hello-World`. Watch `/repositories/[id]` until `READY`.

Details: [docs/INDEXING.md](docs/INDEXING.md).

### Tooling

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format
```

## Security (non-negotiable)

- Repositories are untrusted input. **Read, parse, analyze, embed. Never execute.**
- Platform AI keys stay on the server. The browser never receives the Demo AI key.
- Every data query must enforce the authenticated user as owner.

See [docs/SECURITY.md](docs/SECURITY.md).

## What is not built yet

Tree-sitter, embeddings, RAG, chat streaming, BYOK encryption, impact analysis, PR/issue ingestion, and production deploy. See [docs/PRD.md](docs/PRD.md).
