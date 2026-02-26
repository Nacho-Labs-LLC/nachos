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

# Create non-root user BEFORE copies
RUN addgroup -g 1001 -S nachos && \
    adduser -S nachos -u 1001 -G nachos

WORKDIR /app
RUN chown nachos:nachos /app
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

USER nachos

# Copy with correct ownership (no chown -R needed)
COPY --chown=nachos:nachos package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=nachos:nachos tsconfig.base.json tsconfig.json ./
COPY --chown=nachos:nachos packages/shared ./packages/shared
COPY --chown=nachos:nachos packages/core/bus ./packages/core/bus
COPY --chown=nachos:nachos packages/channels/base ./packages/channels/base
COPY --chown=nachos:nachos packages/channels/discord ./packages/channels/discord

RUN pnpm install --frozen-lockfile

COPY --chown=nachos:nachos . .
COPY --from=config --chown=nachos:nachos /app/packages/shared/config/dist ./packages/shared/config/dist

WORKDIR /app/packages/channels/discord
CMD ["npx", "tsx", "watch", "src/main.ts"]
