# Changelog

## 0.7.0 — personal providers and release readiness

- Add encrypted personal AI settings and streaming adapters for OpenAI, Anthropic, Gemini, OpenRouter, and approved custom APIs.
- Add packaged multilingual parsers, import aliases/workspace entry points, and conservative symbol reference impact evidence.
- Add optional full-branch history, commit pagination, PR changed paths, and explicit issue/file linking.
- Add shared request limits, body/origin guards, index enqueue recovery, and serialized re-index jobs.
- Add database ownership/integration checks, browser smoke tests, pinned CI actions, Vercel configuration, and a verified non-root worker container.

## 0.6.0 — Phase 6 recent history and impact

- Index a bounded Git commit window and changed-file paths from the read-only clone.
- Sync recent public PR and issue summaries, filtering PRs from GitHub's issue list.
- Add owner-protected history, reverse-import impact, and co-change views and APIs.
- Ground chat answers in matching commit, PR, and issue records with checked citation links.

## 0.5.0 — Phase 5 grounded chat

- Add server-side streamed repository chat over retrieved source evidence.
- Validate source citation markers before saving or rendering clickable links.
- Persist owner-scoped sessions, completed turns, and provider token usage.
- Add chat UI, session history, input bounds, and per-user hourly request limits.

## 0.4.0 — Phase 4 retrieval

- Add indexed keyword search and optional OpenAI embeddings for source chunks.
- Add pgvector cosine search and reciprocal-rank fusion for hybrid retrieval.
- Add owner-protected repository search API and UI with commit-pinned source links.
- Keep keyword search available when no embedding key is configured.

## 0.3.0 — Phase 3 source intelligence (first slice)

- Store bounded UTF-8 source content and line-aware chunks for accepted files.
- Extract TypeScript/JavaScript declarations, methods, and imports without executing code.
- Record markdown and selected configuration documents, plus file-level import edges.
- Add owner-protected, paginated file browsing and line-addressable source view.
- Fix canonical root handling when scanning temporary clones on macOS.

## 0.1.0 — Milestone 1 (foundation)

- Monorepo: `apps/web`, `packages/api`, `packages/db`, `packages/shared`.
- Product docs: README, PRD, architecture, security, decisions.
- TypeScript tooling, Vitest, ESLint, Prettier, GitHub Actions CI.
- Drizzle-oriented PostgreSQL schema and SQL migrations.
- Supabase Auth scaffolding and protected route/API patterns.
- Landing shell and repository CRUD stubs (no ingestion).

## 0.2.0 — Milestone 2 (repository ingestion)

- GitHub URL validation/normalization and typed ingest errors.
- Submit public GitHub URL → metadata check → repository + `index_jobs` + BullMQ.
- Detect already-added repositories for the same user.
- `apps/worker` clones with read-only git (never executes repository code).
- File scanner with ignore rules, size/timeout limits, binary detection, symlink/path guards.
- Snapshot + files persistence and UI/API index progress.
