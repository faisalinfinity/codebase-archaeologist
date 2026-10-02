# Indexing (Milestones 2–4)

Milestone 2 implements SDLC Phase 4 / First Implementation Order steps 6–9: repository CRUD, GitHub URL validation, a real BullMQ worker, read-only clone, file scan, snapshot, and job progress.

## Flow

```text
Submit public GitHub URL
        → parse/normalize owner/repo (no network)
        → if this user already added it, return that record
        → GitHub API metadata (public? size? default branch?)
        → insert repositories + index_jobs (PENDING)
        → enqueue BullMQ job repository:index
        → worker: CLONING (git clone --depth 1, hooks disabled)
        → create repository_snapshots at HEAD SHA
        → SCANNING (ignore rules, size limits, symlink/path guards)
        → parse accepted text files and extract symbols/imports/chunks
        → persist files, source text, documents, and import edges
        → EMBEDDING (when configured) → FINALIZING → READY
```

The Phase 3 slice parses JavaScript and TypeScript with the TypeScript compiler API. It creates bounded chunks for all accepted UTF-8 text and stores Markdown and key configuration documents. Phase 4 adds indexed keyword search and optional embeddings. Set `OPENAI_API_KEY` on both web and worker, then re-index to enable hybrid retrieval. AI answers, chat, PR/issue ingestion, and parsers for other languages are still pending.

## Security

The worker **never** executes repository code. It does not run `npm install`, `make`, Docker builds, or any hook/script from the cloned tree.

Git is invoked with `execFile` (no shell interpolation), `core.hooksPath=/dev/null`, `--no-recurse-submodules`, and `GIT_TERMINAL_PROMPT=0`. Clone URLs are always `https://github.com/{owner}/{repo}.git` after charset validation.

Symlinks that resolve outside the clone directory are skipped. Paths that escape the root are skipped.

## Ignore rules

Skipped: `node_modules/`, `.git/`, `.next/`, `dist/`, `build/`, `coverage/`, `.cache/`, `vendor/`, `target/`, `venv/`, `__pycache__/`, lockfiles, `*.min.js`, media/archives, `.env` (not `.env.example`).

## Limits (environment)

| Variable                 | Default |
| ------------------------ | ------- |
| `MAX_REPOSITORY_SIZE_MB` | 500     |
| `MAX_FILES`              | 20000   |
| `MAX_FILE_SIZE_MB`       | 1       |
| `CLONE_TIMEOUT_MS`       | 120000  |
| `SCAN_TIMEOUT_MS`        | 120000  |
| `MAX_EMBED_CHUNKS`       | 2000    |
| `EMBED_TIMEOUT_MS`       | 600000  |

GitHub’s repository `size` field is treated as KiB.

## Failure codes

| Code                   | When                                            |
| ---------------------- | ----------------------------------------------- |
| `INVALID_GITHUB_URL`   | URL is not a github.com owner/repo              |
| `REPOSITORY_NOT_FOUND` | GitHub 404 (also how private repos appear anon) |
| `PRIVATE_REPOSITORY`   | GitHub reports `private: true`                  |
| `GITHUB_RATE_LIMITED`  | GitHub 403/429 with remaining=0                 |
| `REPOSITORY_TOO_LARGE` | Over `MAX_REPOSITORY_SIZE_MB`                   |
| `INDEX_TIMEOUT`        | Clone or scan exceeded timeout                  |
| `INDEX_FAILED`         | Other ingest or embedding failure               |
| `REDIS_UNAVAILABLE`    | Queue enqueue failed                            |

## Local end-to-end

Requires Docker for Postgres + Redis, Git, a Supabase project for auth, and two processes:

```bash
docker compose up -d
cp .env.example apps/web/.env.local
# fill NEXT_PUBLIC_SUPABASE_* and keep DATABASE_URL + REDIS_URL
export DATABASE_URL=postgresql://archaeologist:archaeologist@localhost:5432/archaeologist
pnpm db:migrate
pnpm dev
# other terminal:
export DATABASE_URL=postgresql://archaeologist:archaeologist@localhost:5432/archaeologist
export REDIS_URL=redis://localhost:6379
# optional: export OPENAI_API_KEY in both terminals for semantic indexing/search
pnpm worker
```

Sign in, add this small public fixture:

```text
https://github.com/octocat/Hello-World
```

The repository page should move through `PENDING` → `CLONING` → `SCANNING` → `PARSING` → `ANALYZING` → optional `EMBEDDING` → `FINALIZING` → `READY` and show a commit SHA plus indexed file count. **Browse indexed files** opens source text and line-addressable symbols; **Search source** searches the ready snapshot.

If `REDIS_URL` is unset, the API still creates a `PENDING` job but nothing runs until Redis and the worker are up. Use **Retry index** on the repository page after starting them.

## Tests

Deterministic coverage (no GitHub/Redis required):

- URL parser and ignore rules (`packages/shared`)
- GitHub API error mapping with mocked `fetch` (`packages/api`)
- Repository create / already-exists / authz (`packages/api`)
- Scanner: ignore, secrets, oversize, symlink escape (`packages/ingestion`)
- Local `git init` fixture clone + snapshot (`packages/ingestion`, `apps/worker`)
