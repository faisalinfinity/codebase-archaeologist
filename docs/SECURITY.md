# Security

## Untrusted repository rule (mandatory)

Repositories submitted by users are **untrusted input**.

The index worker must **not execute repository code**. That includes, without limitation:

```text
npm / pnpm / yarn install or run
pip install, python setup.py
cargo build, go run
make, ./configure
Dockerfile / compose build or run
any repository script or binary
```

MVP posture:

> Read, parse, analyze, embed. Never execute.

Git usage is restricted to read-only clone, log, and diff-tree operations required to ingest a snapshot and recent history. Do not run hooks (`core.hooksPath=/dev/null`). Disable or ignore repository-provided hook scripts. Treat symlinks, archives, and path traversal as hostile.

Required ingest guards:

- file-size and repository-size limits
- clone and scan timeouts; worker CPU/memory limits remain a deployment requirement
- path traversal protection
- symlink / archive safeguards
- binary detection
- ignore lists (`node_modules`, `.git` objects as execution, build output, lockfiles, media)
- never index secret values from `.env` (`.env.example` is allowed as documentation)
- cap the number of chunks sent to an embedding provider per index job

A future isolated execution feature would need its own design, sandbox, review, and milestone. It is not a flag on the current worker.

## Key handling

| Secret                          | Where it may exist                               | Where it must not exist                       |
| ------------------------------- | ------------------------------------------------ | --------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser (public client key)                      | Treated as a privileged secret                |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server / worker only                             | Browser, logs, client bundles, git            |
| `DEMO_AI_API_KEY`               | Server process env                               | Browser, `NEXT_PUBLIC_*`, chat payloads, logs |
| `OPENAI_API_KEY`                | Web server and worker env for embeddings         | Browser, `NEXT_PUBLIC_*`, API responses, logs |
| User BYOK                       | Encrypted at rest; decrypted in memory on server | Browser after submit, chat_messages, logs     |
| `ENCRYPTION_KEY`                | Server / KMS                                     | Browser, git, CI logs                         |
| `DATABASE_URL`                  | Server / worker / migrate job                    | Browser                                       |
| GitHub tokens                   | Server / worker                                  | Browser                                       |

Rules:

- Never commit `.env` files.
- Never print secrets in CI logs.
- Never send platform or user provider keys to the client.
- Do not store raw user API keys in `chat_messages` or structured logs.
- Demo AI is a **server-side** provider. The model name may be public; the key is not.

`.env.example` lists names and dummy values only.

When `OPENAI_API_KEY` is configured, the worker sends bounded snippets of indexed public source to OpenAI for embeddings, and the web server sends search queries for semantic retrieval. Keep this option disabled when that data must not leave the deployment.

## Authentication and authorization

- All API endpoints require a session except explicitly public ones (`/`, `/login`, `/auth/callback`, `/api/health`).
- Every repository, chat, chunk, and provider query must verify `owner_user_id` (or equivalent membership). Do not trust IDs from the browser.
- User A must not read User B’s repositories, chunks, chats, provider configs, or usage events.
- Indexed source text, symbols, imports, and search hits are returned only after repository ownership is checked and a snapshot is `READY`.
- On Supabase-hosted Postgres, enable RLS (`packages/db/supabase/rls.sql`) **in addition to** application checks. Database integration tests verify source/history/chat ownership with a non-privileged role; live Supabase configuration must also be verified at release.

## Prompt injection and citations

Indexed file contents, commit messages, PR bodies, and issue bodies are data, not instructions. The chat provider receives bounded evidence labeled as untrusted. Citation markers in model output are hints only; the application resolves them from **validated internal source and history records** before saving or rendering links. A completed answer without a valid citation is replaced with a grounded fallback.

## HTTP and abuse

Chat has a per-user hourly limit, bounded questions, limited history/evidence, and a model output cap. Repository creation/index requests, chat attempts, and provider settings writes use atomic database-backed per-user hourly counters. GitHub context requests have bounded concurrency and page counts. Request JSON is byte-bounded and browser mutations validate their origin. Limits live in configuration, not hardcoded commercial numbers.

## Incident notes

If a platform key may have leaked: rotate it, invalidate sessions if the leak is auth-related, and audit `usage_events`. Do not discuss secret values in tickets or chat transcripts.

## Personal provider keys and custom endpoints

Personal keys are encrypted with AES-256-GCM, a fresh nonce, and owner ID as authenticated additional data. The deployment must provide a stable, 64-hex-character `ENCRYPTION_KEY`. Settings reads return provider/model/base URL and a saved-key flag; neither plaintext keys nor ciphertext return to the browser. Browser-facing Supabase roles have no API-key row policy.

Custom endpoints require an exact HTTPS origin in `CUSTOM_AI_ALLOWED_ORIGINS`. Credentials, query parameters, fragments, and literal IP hosts are rejected. DNS addresses are checked when opening each socket, private/reserved addresses are blocked, and redirects are never followed. API headers and upstream error bodies are never returned to the browser.
