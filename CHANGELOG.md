# Changelog

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
