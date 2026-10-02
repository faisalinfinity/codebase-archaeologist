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

Git usage is restricted to the read-only operations required to ingest a snapshot (clone/fetch of a known SHA). Do not run hooks (`core.hooksPath=/dev/null`). Disable or ignore repository-provided hook scripts. Treat symlinks, archives, and path traversal as hostile.

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
- On Supabase-hosted Postgres, enable RLS (`packages/db/supabase/rls.sql`) **in addition to** application checks. Test RLS explicitly before calling auth “done” for production.

## Prompt injection and citations (later, designed now)

Indexed file contents are data, not instructions. System prompts must treat repository text as untrusted. Citations in model output are hints only; the application must resolve citations from **validated internal source records** (file path, line range, commit SHA) before rendering links.

## HTTP and abuse

Planned: rate limits on repository creation, indexing, chat, GitHub API, and provider tests. Demo AI is stricter than BYOK. Limits live in configuration, not hardcoded commercial numbers. Configurable caps: repository size, file size, file count, timeouts, max tokens.

## Incident notes

If a platform key may have leaked: rotate it, invalidate sessions if the leak is auth-related, and audit `usage_events`. Do not discuss secret values in tickets or chat transcripts.
