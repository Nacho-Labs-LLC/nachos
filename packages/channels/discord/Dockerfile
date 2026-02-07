FROM node:22-alpine AS development

# Create non-root user
RUN addgroup -g 1001 -S nachos && \
    adduser -S nachos -u 1001 -G nachos

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.json ./

# Copy shared packages and dependencies
COPY packages/shared ./packages/shared
COPY packages/core/bus ./packages/core/bus
COPY packages/channels/base ./packages/channels/base
COPY packages/channels/discord ./packages/channels/discord

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Change ownership
RUN chown -R nachos:nachos /app

USER nachos

# Start in development mode with tsx watch for hot-reload
WORKDIR /app/packages/channels/discord
CMD ["npx", "tsx", "watch", "src/main.ts"]
