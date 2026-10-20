# Codebase Archaeologist

Understand **what** a GitHub codebase does, **why** it exists, **how** a request flows through it, **what changed** over time, and **what impact** a change could have.

This is not generic chat-with-code. Answers are grounded in indexed source, Git history, issues/PRs, and a code graph, with citations back to exact files and lines.

## Current status

**Phase 7 — personal providers, broader analysis, and release validation.** Owners can index public repositories, browse source, use keyword/hybrid retrieval, ask streamed questions with checked citations, inspect history, and explore file/symbol dependencies. Personal provider settings support OpenAI, Anthropic, Gemini, OpenRouter, and approved compatible endpoints; saved keys use authenticated encryption. The worker parses JavaScript/TypeScript plus eleven additional language grammars. History supports paginated browsing and optional full-branch cloning with processing limits. Database integration tests, ownership-policy checks, browser tests, and a production worker container are included.

Deployment target: **Vercel web + a manually triggered GitHub Actions worker**. See [deployment and verification instructions](docs/DEPLOYMENT.md).

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

Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Keep `DATABASE_URL` and `REDIS_URL` for local Compose. To enable chat, set `DEMO_AI_API_KEY` in `apps/web/.env.local`; it stays server-side.

Do **not** put `SUPABASE_SERVICE_ROLE_KEY`, `DEMO_AI_API_KEY`, `OPENAI_API_KEY`, `GITHUB_API_TOKEN`, or `ENCRYPTION_KEY` in any `NEXT_PUBLIC_*` variable. To enable semantic search, set `OPENAI_API_KEY` in `apps/web/.env.local` and export it in the worker terminal, then re-index the repository.

### 3. Database and Redis

```bash
docker compose up -d
export DATABASE_URL=postgresql://archaeologist:archaeologist@localhost:5432/archaeologist
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

## Current limits

Symbol call relationships are resolved conservatively for JavaScript/TypeScript; other supported languages expose declarations and imports. Computed runtime dependencies, ambiguous symbols, inherited tsconfig settings, and arbitrary build-system aliases can remain unresolved. Git history covers the indexed branch within configured count/time limits. Public GitHub context is bounded; incomplete PR file data is labeled. Incremental snapshot reuse, issue-comment ingestion, and deeper cross-language semantics are future enhancements. Private repositories and team features remain outside the MVP.

Live deployment requires hosted Postgres/Redis, configured Supabase Auth, and the configured GitHub Actions worker secrets. Provider adapters have deterministic streaming tests; verify the chosen model/key in the deployed account.
