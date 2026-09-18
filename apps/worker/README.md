# Index worker (Milestone 2+)

This app is a placeholder. The index worker will consume BullMQ jobs (`repository:index`, and later update/embed/finalize), clone public GitHub repositories with **read-only Git**, parse and embed them, and write to Postgres.

It must never execute untrusted repository code (`npm install`, `make`, Docker builds, repository scripts, …). See `docs/SECURITY.md`.
