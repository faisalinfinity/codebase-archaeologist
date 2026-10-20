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

`code_chunks.embedding` and `documents.embedding` are `vector(1536)`. Phase 4 adds an embedding-provider interface and uses 1,536-dimensional OpenAI output. The spec forbids assuming one embedding model forever; supporting a different width requires a migration. Do not treat 1536 as a product contract.

## Deferred (explicitly not Milestone 1)

- Husky / lint-staged — useful later; CI already gates PRs.
- Action SHA pinning — completed in Phase 7.
- Standalone `apps/api` Fastify service.
- Vercel project wiring — configuration and a separate worker image added in Phase 7.

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

## Phase 3 — source intelligence first slice

| Concern        | Choice                               | Notes                                                                                                                       |
| -------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Source storage | Nullable `files.content`             | Max 1 MiB per accepted file by default; invalid UTF-8 remains metadata-only. Existing snapshots require re-indexing.        |
| Parser         | TypeScript compiler API              | Parses JavaScript and TypeScript without executing repository code. Other languages need dedicated parsers in later slices. |
| Chunks         | At most 12,000 characters            | Preserve exact source text and line ranges; Phase 4 embeds bounded segments of each chunk.                                  |
| Imports        | File-level edges                     | Resolve relative imports among indexed files; retain unresolved/external specifiers as evidence.                            |
| Viewer         | Authenticated server-rendered routes | Repository ownership is checked before listing or reading a source file.                                                    |

## Phase 4 — retrieval

| Concern         | Choice                                                | Notes                                                                                                                                                    |
| --------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keyword search  | PostgreSQL `tsvector` with the `simple` configuration | Available for every ready source snapshot without an AI key.                                                                                             |
| Semantic search | Optional server-side OpenAI embeddings                | `text-embedding-3-small` by default; `text-embedding-3-large` is also accepted with `dimensions: 1536`. The key stays in server and worker environments. |
| Vector width    | Existing `vector(1536)` column                        | Provider interface allows replacement; another vector width needs a schema/index migration.                                                              |
| Ranking         | Reciprocal rank fusion                                | Combines top keyword and vector hits without comparing their raw score scales.                                                                           |
| Failure         | Embedding failure marks an index job failed           | Keeps incomplete snapshots out of search. Query-time semantic failures fall back to keyword results.                                                     |

## Phase 5 — grounded chat

| Concern      | Choice                                                           | Notes                                                                                                                 |
| ------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Demo AI      | Server-side OpenAI Responses adapter                             | Uses a configurable model, `store: false`, streamed text deltas, and a bounded output. The default is `gpt-4.1-mini`. |
| Context      | Latest ready snapshot and up to six search hits                  | Send short, source-labeled evidence and limited recent chat history. Repository text is treated as data.              |
| Citations    | Validate `[S1]`-style markers after generation                   | Only markers mapped to retrieved source records become clickable or persist as citations.                             |
| Persistence  | Save complete user/assistant turns in one database transaction   | Failed or disconnected streams do not leave partial turns. Usage events store token counts when returned.             |
| Abuse bounds | 2,000-character questions, hourly per-user limit, bounded output | Server-side configuration controls limits; provider keys never reach the browser.                                     |

## Phase 6 — recent history and impact

| Concern        | Choice                                                     | Notes                                                                                                                                   |
| -------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Git history    | Read-only `git log` and `git diff-tree` on a shallow clone | Default window is 50 commits; only changed paths and bounded commit messages are saved. Repository code remains unexecuted.             |
| GitHub context | Public REST PR and issue lists                             | Fetch one bounded page per type. GitHub issues containing `pull_request` are excluded. API failure leaves code/history indexing usable. |
| Impact         | Reverse traversal of resolved local imports, three hops    | Also surface files co-changed in the recent commit window. Dynamic imports, aliases, and runtime dependencies need later analysis.      |
| Chat evidence  | Source, commit, PR, and issue markers                      | `[S]`, `[H]`, `[P]`, and `[I]` links are validated against retrieved records before persistence and rendering.                          |

## Phase 7 — providers, analysis, and release checks

- One active personal provider per user; AES-256-GCM uses owner-bound authenticated data and a stable server encryption key. Key reads are server-only.
- Provider adapters use Anthropic native SSE and OpenAI-compatible chat SSE for OpenAI/Gemini/OpenRouter/custom APIs. Model IDs are supplied by users rather than assuming account availability. See the [OpenAI streaming reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events), [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), [Gemini compatibility](https://ai.google.dev/gemini-api/docs/openai), and [OpenRouter streaming](https://openrouter.ai/docs/api_reference/streaming).
- WASM grammars from `tree-sitter-wasms` are loaded only from installed dependencies; target repository code remains unexecuted. JavaScript/TypeScript keep the existing compiler-API parser and gain conservative reference extraction.
- Full-history mode removes shallow cloning on one branch, while count/time/output limits remain mandatory. PR details are bounded and incomplete results are labeled.
- Deployment target is Vercel web plus a manually triggered GitHub Actions worker to stay within the user’s free-tier constraint. The non-root container remains an optional self-hosted alternative. The worker starts Node directly so it can run under a read-only filesystem without a package-manager cache.
- CI includes fresh Postgres migrations, database integration and RLS tests, browser flows with a local auth fixture, a production web build, and a worker image build.
