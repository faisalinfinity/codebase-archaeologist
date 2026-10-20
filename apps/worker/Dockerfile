FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@10.33.3 --activate

WORKDIR /app
COPY --chown=node:node . .
RUN pnpm --filter @archaeologist/worker... install --prod --frozen-lockfile

ENV NODE_ENV=production
ENV WORKER_CONCURRENCY=1
USER node
WORKDIR /app/apps/worker
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--import", "tsx", "src/index.ts"]
