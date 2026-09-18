# Product decisions

Record stack choices and any deviation from the product specification here. Do not use this file as a changelog.

## Milestone 1 — initial stack

| Concern             | Choice                                       | Notes                                                                                                                                                       |
| ------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo            | pnpm workspaces                              | `apps/*` and `packages/*`. No Turborepo yet; root `pnpm -r` scripts are enough.                                                                             |
| Web                 | Next.js 15 App Router                        | TypeScript, Tailwind CSS, shadcn/ui primitives.                                                                                                             |
| API                 | `packages/api` behind Next.js route handlers | Spec prefers Fastify/NestJS eventually. Milestone 1 keeps a **separate service layer** so handlers stay thin and the API can move to its own process later. |
| Shared types        | `packages/shared`                            | Zod schemas and GitHub URL parsing.                                                                                                                         |
| Database            | PostgreSQL 16 + pgvector                     | Local via `docker compose`; hosted Supabase is compatible.                                                                                                  |
| ORM / migrations    | **Drizzle ORM** + ordered SQL files          | See below.                                                                                                                                                  |
| Auth                | Supabase Auth (`@supabase/ssr`)              | Email/password + magic-link capable. Session cookies; middleware protects UI routes; `requireUser` protects APIs.                                           |
| Client server-state | TanStack Query (not wired yet)               | Will be used when dashboard lists are live.                                                                                                                 |
| Queue               | Redis + BullMQ                               | Compose includes Redis. Milestone 2 adds `apps/worker`.                                                                                                     |
| Tests               | Vitest                                       | Unit tests for URL parsing, auth guard, and repository authorization.                                                                                       |
| Lint / format       | ESLint 9 flat config + Prettier              | `typescript-eslint` recommended; Next.js lint in `apps/web`.                                                                                                |
| CI                  | GitHub Actions `ci.yml`                      | lint, format, typecheck, test, build. Least-privilege `contents: read`. Placeholder public env only.                                                        |
| Package manager     | pnpm 10                                      | Pinned via `packageManager`.                                                                                                                                |

## Why Drizzle instead of Prisma

The spec allows either. Drizzle was chosen because:

1. SQL migrations are first-class and reviewable as `.sql` files.
2. pgvector columns map cleanly (`vector` type) without a Prisma preview-feature dance.
3. Schema sketches for later milestones can exist without generating a heavy client.
4. The runtime client is small and TypeScript-first.

Prisma remains acceptable later if the team prefers it; switching would be a documented decision plus a migration port.

## Why Next route handlers instead of Fastify in Milestone 1

A separate Fastify process would require two local servers and a CORS/session story before any product surface exists. Domain logic lives in `packages/api` with **no Next.js imports**, so extraction is a wiring change, not a rewrite.

## Environment variable naming

The spec lists `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Next.js only exposes variables to the browser when they use the `NEXT_PUBLIC_` prefix. Milestone 1 therefore uses:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL`

Server-only names (`DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, future `DEMO_AI_API_KEY`) stay unprefixed. The anon key is a public client key; the **service role key must never** be `NEXT_PUBLIC_`.

## Auth user records

`public.users.id` is the Supabase Auth user UUID. The API upserts `public.users` on first authenticated request so local Postgres works without Supabase's `auth` schema or database webhooks. RLS SQL is provided as an optional Supabase-oriented file (`packages/db/supabase/rls.sql`) and is **not** applied by the generic migrator (it requires `auth.uid()`).

## Embedding dimensions

`code_chunks.embedding` and `documents.embedding` are `vector(1536)` as a **placeholder** matching a common OpenAI embedding width. The spec forbids assuming one embedding model forever. Milestone 4 must introduce an embedding-provider abstraction and may alter this column (new table, or per-model dimensions). Do not treat 1536 as a product contract.

## Deferred (explicitly not Milestone 1)

- Husky / lint-staged — useful later; CI already gates PRs.
- Action SHA pinning — follow-up hardening for `.github/workflows`.
- Standalone `apps/api` Fastify service.
- Vercel project wiring (preview deploy is a product goal; this repo prepares a buildable Next.js app).

## Milestone 2 — repository ingestion

| Concern         | Choice                                         | Notes                                                                                                                                                 |
| --------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker          | `apps/worker` + BullMQ + ioredis               | Separate process. Next.js route handlers only enqueue.                                                                                                |
| Clone           | Git CLI via `execFile`                         | `--depth 1`, `--no-recurse-submodules`, `core.hooksPath=/dev/null`. Never a shell string. Never `npm install` / `make` / Docker from the target repo. |
| Scan            | `packages/ingestion` filesystem walk           | Ignore rules in `packages/shared`. Symlink/path-escape skips. Binary NUL + extension detection.                                                       |
| Already indexed | Same-user `(owner, github_owner, github_repo)` | POST `/api/repositories` returns `200` with `alreadyExists: true` instead of 409. Other users still get their own row (isolation).                    |
| GitHub metadata | REST `GET /repos/{owner}/{repo}`               | Maps 404, private, rate limit, and size. Optional `GITHUB_API_TOKEN` (server/worker only).                                                            |
| After scan      | Snapshot `READY`                               | Tree-sitter/embed/GitHub sync are skipped on purpose. Job progress text says so.                                                                      |
| Queue missing   | `NoopIndexQueue` when `REDIS_URL` unset        | Creates PENDING jobs so the web app still starts in CI. Worker + Redis required for live progress.                                                    |
