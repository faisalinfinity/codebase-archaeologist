# Contributing

## Workflow

1. Branch from `main` using `feature/*`, `fix/*`, or `chore/*`.
2. Keep changes small and related.
3. Use conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `security:`, `test:`, `refactor:`).
4. Open a pull request using the template in `.github/PULL_REQUEST_TEMPLATE.md`.
5. CI must pass (`pnpm lint`, `typecheck`, `test`, `build`).

## Coding rules (from the product spec)

- Do not execute untrusted repository code. Ingestion is read / parse / analyze / embed only.
- Do not hardcode secrets. Never log API keys or `Authorization` headers.
- Do not weaken TypeScript strictness to make code compile. Do not use `any` without justification.
- Every production schema change needs a migration.
- Never silently swallow errors. Never expose internal stack traces to users.
- Do not trust LLM-generated citations; resolve them from indexed records (when that pipeline exists).
- Inspect existing modules before adding a parallel solution.

## Packages

Import shared contracts from `@archaeologist/shared`, persistence from `@archaeologist/db`, domain services from `@archaeologist/api`, and clone/scan from `@archaeologist/ingestion`. Next.js pages and route handlers should stay thin. The worker is `apps/worker`.

## Docs

Update `README.md`, `DECISIONS.md`, and the relevant file under `docs/` when behavior or architecture changes.
