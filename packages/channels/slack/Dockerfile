FROM node:22-alpine AS config

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared/config ./packages/shared/config
COPY packages/shared/types ./packages/shared/types
COPY packages/shared/utils ./packages/shared/utils

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nachos/types build && \
    pnpm --filter @nachos/config build

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
COPY --chown=nachos:nachos packages/channels/base ./packages/channels/base
COPY --chown=nachos:nachos packages/channels/slack ./packages/channels/slack

RUN pnpm install --frozen-lockfile

# Inject pre-built config dist before building dependents
COPY --from=config --chown=nachos:nachos /app/packages/shared/config/dist ./packages/shared/config/dist

# Build shared deps in dependency order
RUN pnpm --filter @nachos/types build && \
    pnpm --filter @nachos/utils build && \
    pnpm --filter @nachos/bus build

COPY --chown=nachos:nachos . .

WORKDIR /app/packages/channels/slack
CMD ["npx", "tsx", "watch", "src/main.ts"]
