# Codebase Archaeologist

Understand **what** a GitHub codebase does, **why** it exists, **how** a request flows through it, **what changed** over time, and **what impact** a change could have.

This is not generic chat-with-code. Answers are grounded in indexed source, Git history, issues/PRs, and a code graph, with citations back to exact files and lines.

## Current status

**Milestone 1 — foundation.** Monorepo, docs, TypeScript tooling, PostgreSQL migrations, and Supabase Auth scaffolding. Repository CRUD is a compile-ready stub. Ingestion, embeddings, RAG, chat, and workers are intentionally out of scope for this milestone.

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
                 | (service layer)   |
                 | Auth, repo mgmt   |
                 | (chat later)      |
                 +---------+---------+
                           |
             +-------------+---------------+
             |             |               |
             v             v               v
       PostgreSQL        Redis         Object Storage
       + pgvector       BullMQ          (optional)
       packages/db      (Milestone 2)   (later)
```

Next.js route handlers call `packages/api`. The API can later move to a standalone Fastify/NestJS process without rewriting domain logic. Workers (clone/parse/embed) will be a separate app; they must **never execute untrusted repository code**.

## Monorepo

| Path              | Role                                            |
| ----------------- | ----------------------------------------------- |
| `apps/web`        | Next.js App Router UI + thin route handlers     |
| `packages/api`    | Domain services (auth, repositories)            |
| `packages/db`     | Drizzle schema, SQL migrations, Postgres client |
| `packages/shared` | Shared types, Zod schemas, GitHub URL parsing   |
| `docs/`           | PRD, architecture, security                     |
| `DECISIONS.md`    | Stack choices and deviations                    |

## Local setup

### Prerequisites

- Node.js 22+
- pnpm 10+ (`corepack enable`)
- Docker (Postgres + Redis) **or** a Supabase project
- A Supabase project for Auth (email/password or magic link)

### 1. Install

```bash
pnpm install
```

### 2. Environment

```bash
cp .env.example apps/web/.env.local
```

Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the Supabase dashboard (Settings → API). Leave `DATABASE_URL` pointing at local Postgres, or use the Supabase connection string.

Do **not** put `SUPABASE_SERVICE_ROLE_KEY`, `DEMO_AI_API_KEY`, or `ENCRYPTION_KEY` in any `NEXT_PUBLIC_*` variable.

### 3. Database

```bash
docker compose up -d
pnpm db:migrate
```

Migrations live in `packages/db/migrations` and are applied in filename order. They are safe to re-run (tracked in `schema_migrations`).

### 4. Auth provider (Supabase)

In the Supabase dashboard:

1. Enable Email auth (password and/or magic link).
2. Set the Site URL to `http://localhost:3000`.
3. Add redirect URL `http://localhost:3000/auth/callback`.

### 5. Run the app

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in at `/login`. Protected routes: `/dashboard`, `/repositories/*`.

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

Tree-sitter, embeddings, RAG, chat streaming, workers that clone repos, GitHub ingestion, BYOK encryption, impact analysis, and production deploy. See [docs/PRD.md](docs/PRD.md).
