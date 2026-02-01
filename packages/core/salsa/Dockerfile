FROM node:22-alpine AS development

# Install development dependencies
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nachos && \
    adduser -S nachos -u 1001 -G nachos

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.json ./

# Copy shared packages
COPY packages/shared ./packages/shared

# Copy salsa package
COPY packages/core/salsa ./packages/core/salsa

# Install dependencies
RUN pnpm install --frozen-lockfile

# Change ownership
RUN chown -R nachos:nachos /app

USER nachos

# Expose port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "process.exit(0)" || exit 1

# Start in development mode with tsx watch for hot-reload
CMD ["pnpm", "--filter", "@nachos/salsa", "run", "dev"]
