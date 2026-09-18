# Index worker

Consumes BullMQ jobs (`repository:index`), clones **public** GitHub repositories with **read-only Git**, scans files, and writes `repository_snapshots` + `files`.

It must **never** execute untrusted repository code (`npm install`, `make`, Docker builds, repository scripts, git hooks, …). See `docs/SECURITY.md` and `docs/INDEXING.md`.

## Run locally

Redis and Postgres must be up:

```bash
docker compose up -d
pnpm db:migrate
export DATABASE_URL=postgresql://archaeologist:archaeologist@localhost:5432/archaeologist
export REDIS_URL=redis://localhost:6379
pnpm --filter @archaeologist/worker start
```

Optional: `GITHUB_API_TOKEN` raises GitHub API rate limits. `WORKER_CONCURRENCY` defaults to 1.

Git must be installed on the worker host. Clone flags always include `--depth 1`, `--no-recurse-submodules`, and `core.hooksPath=/dev/null`.
