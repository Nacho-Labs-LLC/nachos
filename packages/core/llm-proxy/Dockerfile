FROM node:22-alpine AS config

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared/config ./packages/shared/config
COPY packages/shared/types ./packages/shared/types
COPY packages/shared/utils ./packages/shared/utils

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nachos/config build

FROM node:22-alpine AS development

RUN addgroup -g 1001 -S nachos && \
    adduser -S nachos -u 1001 -G nachos

WORKDIR /app
RUN chown nachos:nachos /app
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

USER nachos

COPY --chown=nachos:nachos package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=nachos:nachos tsconfig.base.json tsconfig.json ./
COPY --chown=nachos:nachos packages/shared ./packages/shared
COPY --chown=nachos:nachos packages/core/bus ./packages/core/bus
COPY --chown=nachos:nachos packages/core/llm-proxy ./packages/core/llm-proxy

RUN pnpm install --frozen-lockfile

COPY --chown=nachos:nachos . .
COPY --from=config --chown=nachos:nachos /app/packages/shared/config/dist ./packages/shared/config/dist

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/packages/core/llm-proxy
CMD ["npx", "tsx", "watch", "src/index.ts"]
