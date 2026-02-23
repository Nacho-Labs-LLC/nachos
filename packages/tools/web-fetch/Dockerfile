# Web Fetch Tool Dockerfile
FROM node:22-alpine

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.json ./

# Copy shared packages (workspace deps)
COPY packages/shared ./packages/shared

# Copy tool package
COPY packages/tools/web-fetch ./packages/tools/web-fetch

# Install dependencies
RUN pnpm install --frozen-lockfile

# Provide minimal root tsconfig
RUN echo '{"extends":"./tsconfig.base.json","compilerOptions":{"composite":true},"files":[],"references":[{"path":"./packages/shared/types"},{"path":"./packages/shared/utils"}]}' > tsconfig.json

# Build
RUN pnpm --filter @nachos/tool-web-fetch build

# Create non-root user
RUN addgroup -g 1001 nachos && \
    adduser -D -u 1001 -G nachos nachos

USER nachos

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "process.exit(0)"

WORKDIR /app/packages/tools/web-fetch
CMD ["node", "dist/index.js"]
