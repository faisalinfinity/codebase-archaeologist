# Product requirements — MVP

Codebase Archaeologist helps a developer paste a **public GitHub repository URL**, index that repository safely, and ask grounded questions about it.

> Understand what a GitHub codebase does, why it exists, how it evolved, and what could be affected by changing it.

This document is the Milestone 1 / MVP scope cut of the full product specification. It is not a dump of that spec.

## Personas

| Persona                                | Need                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------- |
| Staff / senior engineer joining a repo | Fast mental model: WHAT the system does, HOW a request flows            |
| Engineer changing a symbol or file     | IMPACT: what else breaks or depends on this                             |
| Engineer reading confusing code        | WHY it was written — commits, PRs, issues as evidence                   |
| Evaluator / demo user                  | Sign in, index a known public repo, chat with Demo AI (server-side key) |

## MVP — in scope (product)

A signed-in user can:

1. Open the website and authenticate.
2. Submit a public GitHub repository URL.
3. Start indexing and watch progress until `READY` (or a clear failure).
4. Open a repository overview.
5. Chat with the repository and receive a **streaming** answer with **source citations** (file + line + GitHub link).
6. Click a citation and see the exact source lines.
7. Ask “why was this written?” and see code plus Git history evidence.
8. Ask “what depends on this?” and see dependency evidence.
9. Optionally configure their own AI provider / BYOK without the key ever returning to the browser.
10. Return to a dashboard of their repositories.

Demo AI uses a **server-side** platform key. BYOK and OpenAI-compatible custom endpoints are in MVP. GitHub OAuth is **not** required to index public repositories.

## MVP — out of scope

- Private GitHub repositories and GitHub App installation (post-MVP).
- Executing repository code, installing its dependencies, running its tests, or building images.
- Arbitrary “agent that writes PRs” or code-execution sandbox.
- Guaranteed correctness of LLM answers (grounding + citations are required; truth is not).
- Multi-tenant org/team billing, SSO, and SCIM.
- Native mobile apps.
- Indexing secrets from `.env` files.

## Milestone 1 (this implementation) — in scope

Foundation only:

- pnpm monorepo (`apps/web`, `packages/api`, `packages/db`, `packages/shared`).
- Product documentation (this file, architecture, security, decisions).
- TypeScript, lint, format, unit test harness, GitHub Actions CI stub.
- PostgreSQL schema/migrations for core tables and a sketch of later tables.
- Supabase Auth scaffolding: sign-in/out, session, protected routes and APIs.
- Minimal landing shell and repository CRUD **stubs** that compile.
- `.env.example` with placeholders, no real secrets.

## Milestone 2 (this implementation) — in scope

Repository ingestion:

- Validate/normalize public GitHub URLs.
- Create per-user repository records; reuse if already added.
- Fetch GitHub metadata; fail clearly on 404, private, rate limit, too large.
- Redis + BullMQ worker process.
- Read-only git clone; file scan with ignore rules and safeguards.
- Snapshot + `index_jobs` progress in API and UI.

## Milestone 2 — out of scope

Tree-sitter, embeddings, RAG, chat streaming, BYOK encryption, impact analysis, PR/issue ingestion, incremental re-index polish beyond first ingest.

## Phase 3 source slice — implemented after Milestone 2

- Store accepted UTF-8 source text within the existing file-size guard.
- Extract TypeScript/JavaScript declarations and file imports with the TypeScript compiler API.
- Persist line-aware chunks, Markdown/configuration documents, and file-level import edges.
- Let the repository owner browse paginated files and line-addressable source.

Parsers for other languages, symbol-level graph relationships, history evidence, and chat remain later work.

## Phase 4 retrieval slice — implemented after Phase 3

- Keyword search over indexed chunks is available without an AI key.
- Optional server-side OpenAI embeddings add vector retrieval during indexing.
- Hybrid results merge keyword and vector ranks and link to commit-pinned source lines.
- Search is scoped to the authenticated owner's latest ready snapshot.

AI answer generation, chat, history evidence, and broader provider choices were later work at Phase 4.

## Phase 5 grounded chat slice — implemented after Phase 4

- Stream answers generated from retrieved source evidence.
- Check model citation markers against source records before saving clickable citations.
- Save owner-scoped sessions and complete turns; record provider token usage.
- Keep chat unavailable when the server Demo AI key is missing while source browsing/search remain usable.

History evidence, impact analysis, BYOK, and broader provider choices were later work at Phase 5.

## Phase 6 recent history and impact slice — implemented after Phase 5

- Store a bounded recent commit window and changed paths from read-only Git.
- Sync recent public PR and issue summaries; keep source indexing usable if GitHub context fetches fail.
- Show owner-protected history and file impact based on reverse local imports and recent co-changes.
- Allow chat to cite matched commits, PRs, and issues as well as source lines.

At Phase 6, full history, PR/issue file linking, richer symbol-level graphs, BYOK, and release validation were still deferred.

## Phase 7 — implemented

- Owner-protected AI settings with AES-256-GCM encrypted keys, model selection, and key removal. OpenAI, Anthropic, Gemini, OpenRouter, and administrator-approved compatible APIs share the streaming provider interface.
- Packaged Tree-sitter WASM grammars for Python, Go, Rust, Java, C/C++, Ruby, C#, PHP, Kotlin, and Swift; existing JavaScript/TypeScript parsing remains in place.
- Conservative JavaScript/TypeScript call, construction, and inheritance edges, named/default/namespace import references, tsconfig path mappings, and workspace entry-point resolution. Ambiguous targets stay unresolved.
- Optional full-branch clones with configurable history count/time limits, paginated commit browsing, changed-file PR metadata, and issue file links from explicit path mentions and linked closing PRs.
- Shared database request limits, bounded request bodies, mutation-origin checks, queue failure recovery, and serialized index-job creation.
- Database integration/ownership tests, local browser fixtures, CI Postgres/Redis services, a Vercel project configuration, and a non-root worker container with a deployment guide.

Deployment provisioning and live-account verification depend on the chosen hosting accounts. See [DEPLOYMENT.md](DEPLOYMENT.md). Full runtime dependency inference, incremental snapshot reuse, and issue comments remain enhancements beyond this slice.

## Functional requirements (full MVP)

| ID  | Requirement                                                                           |
| --- | ------------------------------------------------------------------------------------- |
| F1  | Accept, validate, and normalize public GitHub repository URLs.                        |
| F2  | Create per-user repository records; do not leak another user’s data.                  |
| F3  | Clone/read with Git in a worker **without executing** repository programs.            |
| F4  | Parse supported languages via AST (Tree-sitter), extract symbols and edges.           |
| F5  | Index docs and important config; ignore `node_modules`, binaries, lockfiles, secrets. |
| F6  | Index commits, file history, public issues and PRs.                                   |
| F7  | Embed chunks into PostgreSQL + pgvector; hybrid retrieve; cite sources.               |
| F8  | Chat answers WHAT / WHY / HOW / WHAT CHANGED / IMPACT, not generic summaries.         |
| F9  | Provider router: OpenAI, Anthropic, Gemini, OpenRouter, OpenAI-compatible custom.     |
| F10 | Demo AI key never leaves the server. BYOK stored encrypted at rest.                   |
| F11 | Idempotent index jobs with a visible state machine and retries.                       |
| F12 | Rate limits and configurable size/timeout/cost guards.                                |

## Non-functional requirements

- TypeScript-first, strict.
- Production error handling; no stack traces in user-facing responses.
- Observability via structured logs (no secrets).
- Reproducible migrations; CI gates on lint, typecheck, tests, build.
- Easy provider replacement via interfaces.

## Authorization model

```text
user
  ├── repositories
  ├── chat sessions
  └── provider configs / API keys
```

A user must not read another user’s repositories, chunks, chats, provider configs, or usage events. Frontend checks are insufficient; API and (on Supabase) RLS must enforce ownership.

## Acceptance (full MVP)

See the product spec §83. Milestone 1 is accepted when:

- `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` succeed.
- Migrations apply to an empty Postgres with pgvector.
- A user can sign in and out against Supabase (with documented placeholder env).
- Unauthenticated requests to `/dashboard` and `/api/repositories` are rejected.
- Docs exist and match the implemented stack (`DECISIONS.md`).
