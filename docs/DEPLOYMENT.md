# Vercel web and manual GitHub Actions worker

The web app runs on Vercel. A manually triggered GitHub Actions job processes the BullMQ queue and exits when it is drained. Auth/Postgres use Supabase; the queue uses Upstash Redis. There is no continuously billed worker host. Indexing stays queued until **Run workflow** is clicked.

## Selected services

Use the intended existing Supabase project for Postgres/Auth. The free Upstash Redis database `codebase-archaeologist-redis` is provisioned and connected to Vercel, with eviction and paid auto-upgrades disabled. Use its TLS Redis URL (`rediss://…`), not a REST URL/token. The hosted connection and BullMQ job processing have been verified.

The GitHub repository is private. Manual worker runs consume the account's included Actions minutes; there is no scheduled workflow. Keep paid Actions usage disabled or capped in account billing to prevent overages. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) explains the allowance and budgets.

The Vercel project is `faisalinfinitys-projects/codebase-archaeologist`, configured for `apps/web` and Node.js 22. The intended Supabase connection and the GitHub repository secrets must be configured before a functional release.

## Database and authentication

1. In Supabase, enable pgvector and choose a connection method appropriate to the host. A session pooler connection supports IPv4; a transaction pooler connection needs prepared statements disabled. The application disables prepared statements and uses small serverless pools. Use a direct/session connection for migrations. Provision Redis with TLS. Keep preview and production databases/queues separate.
2. Apply migrations from the repository root: `DIRECT_DATABASE_URL="$DIRECT_DATABASE_URL" corepack pnpm db:migrate`. The direct URL must point to the intended environment. Include `sslmode=require` or verified TLS settings in hosted connection URLs.
3. For Supabase-hosted Postgres, apply `packages/db/supabase/rls.sql` once after migrations. It requires `auth.uid()` and is separate from the generic migrator. The runtime database role must have server access; browser sessions must never receive database credentials.
4. Enable Supabase email auth. Set the Site URL to the deployed origin and allow `https://YOUR_DOMAIN/auth/callback`. Add preview origins deliberately when needed.

## Vercel project

Import this repository as a Next.js project. Set **Root Directory** to `apps/web` and enable access to files outside the root directory. The project includes `apps/web/vercel.json` for the pnpm install/build commands. Use Node.js 22.

Configure these environment variables per deployment environment:

| Variable                            | Purpose                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_APP_URL`               | Exact deployed HTTPS origin used by mutation-origin checks and auth redirects  |
| `NEXT_PUBLIC_SUPABASE_URL`          | Supabase project URL                                                           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`     | Public Supabase client key                                                     |
| `DATABASE_URL`                      | Server-side pooled Postgres URL                                                |
| `REDIS_URL`                         | Hosted Redis URL reachable from Vercel and the worker                          |
| `ENCRYPTION_KEY`                    | Stable 32-byte key encoded as 64 hexadecimal characters; enables personal keys |
| `DEMO_AI_API_KEY` / `DEMO_AI_MODEL` | Optional server Demo AI                                                        |
| `OPENAI_API_KEY`                    | Optional semantic retrieval; configure the same embedding model on the worker  |
| `GITHUB_API_TOKEN`                  | Optional GitHub metadata token                                                 |
| `CUSTOM_AI_ALLOWED_ORIGINS`         | Optional comma-separated exact HTTPS origins permitted for custom providers    |

Generate the encryption key with `openssl rand -hex 32` and save it in your secret manager. Keep it across redeployments; changing it requires users to re-enter their personal keys. No encryption or provider secret may use a `NEXT_PUBLIC_` prefix.

Deploy a preview, then verify `/api/health`, sign-in, indexing to READY, source/search, history/impact, and a cited chat answer before promoting to production. Use `corepack pnpm build` locally to validate the production bundle. SSE chat handlers declare a 180-second duration with a 150-second OpenRouter deadline and periodic stream heartbeats. This fits Vercel Hobby’s 300-second limit with Fluid compute.

## Manual indexing worker

The workflow is `.github/workflows/index-worker.yml`. Once it is on the default branch, add these GitHub Actions repository secrets:

| Secret                | Value                                                                      |
| --------------------- | -------------------------------------------------------------------------- |
| `INDEX_DATABASE_URL`  | Supabase direct/session-pooler URL reachable from GitHub runners, with TLS |
| `INDEX_REDIS_URL`     | The same Upstash `rediss://…` queue URL used by Vercel                     |
| `INDEX_EMBEDDING_KEY` | Optional embedding key; omit for keyword-only indexing                     |

After adding/re-indexing repositories in the app, open **Actions → Process indexing queue → Run workflow**. The worker uses `WORKER_RUN_ONCE=1`, processes queued jobs with one concurrent job, and exits after draining the queue. Runs have a 20-minute cap. Delayed retries or jobs arriving after the run closes can be handled by running the workflow again.

Manual dispatch needs the workflow on the default branch. Repository publication/merge and secret setup must be completed before the hosted worker is usable. The tested container below remains an optional self-hosted alternative.

## Optional worker container

Build from the repository root:

```bash
docker build -f apps/worker/Dockerfile -t codebase-archaeologist-worker .
```

Deploy that image to your container provider with `DATABASE_URL`, `REDIS_URL`, optional `GITHUB_API_TOKEN`, and optional `OPENAI_API_KEY`. Give it writable temporary storage, 2 GiB memory, a CPU limit, and at least 120 seconds for graceful shutdown. It runs as a non-root user. Restrict outbound traffic to GitHub, Postgres, Redis, and the embedding provider as needed.

For a Docker host, `deploy/worker.compose.yml` supplies these limits:

```bash
docker compose -f deploy/worker.compose.yml up -d --build
```

Database migrations run separately before the worker and web release. Do not place Supabase service-role keys, personal-key encryption keys, or Demo AI keys in the worker environment; it does not need them.

## Operational verification

- Confirm worker logs show `worker_started`; then index a small public repository and verify `index_job` ends with `ready`.
- Check errors, queue depth, job age, memory, disk usage, and provider token usage in the host's monitoring system. Alert on failed jobs and stalled progress.
- Keep Postgres backups and retain the previous image/deployment for rollback. Avoid deleting schema/data to roll back application code.
- `HISTORY_MODE=full` removes shallow cloning on the indexed branch. `MAX_HISTORY_COMMITS` (default 10,000 in full mode) and history/clone timeouts still bound processing; it does not ingest every branch or promise unlimited history.

## Reproducible local verification

```bash
docker compose -p archaeologist-verify -f tests/docker-compose.verify.yml up -d --wait
export TEST_DATABASE_URL=postgresql://archaeologist:verification-only@127.0.0.1:55432/archaeologist_verify
DATABASE_URL="$TEST_DATABASE_URL" corepack pnpm db:migrate
corepack pnpm test
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
docker compose -p archaeologist-verify -f tests/docker-compose.verify.yml down
```

Browser tests use a local Supabase protocol fixture and an isolated database ending in `_verify`. The application retains its normal authentication and authorization checks. Provider streaming is tested with deterministic HTTP fixtures; live provider and Supabase account checks are still required on the deployed environment.

References: [Vercel monorepos](https://vercel.com/docs/monorepos), [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting).

## OpenRouter reasoning models

The app reads OpenRouter’s public model capabilities without sending a user key or source content. For zero-price `:free` models with reasoning enabled, it chooses the lowest supported effort and keeps reasoning out of the visible answer. For zero-price `:free` reasoning models, a separate combined reasoning/output token budget defaults to 8,192 (`MAX_FREE_REASONING_TOKENS`, capped at 16,384). Paid models retain the normal configured token cap. The selected model ID is preserved and requests never silently fall back to a paid model.

Chat errors identify token exhaustion, invalid keys, rate limits, unavailable models, account limits, or OpenRouter privacy routing restrictions without exposing raw provider messages, prompts, or credentials. Safe error codes are logged for support.
