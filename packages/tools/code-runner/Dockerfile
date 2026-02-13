# Code Runner Dockerfile
# Combined Node.js + Python execution environment

FROM node:22-alpine

# Create app directory
WORKDIR /app

# Install Python 3
RUN apk add --no-cache python3

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.json ./

# Copy shared packages (workspace deps)
COPY packages/shared ./packages/shared

# Copy tool package
COPY packages/tools/code-runner ./packages/tools/code-runner

# Install dependencies
RUN pnpm install --frozen-lockfile

# Provide minimal root tsconfig (avoids references to packages not in this image)
RUN echo '{"extends":"./tsconfig.base.json","compilerOptions":{"composite":true},"files":[],"references":[{"path":"./packages/shared/types"},{"path":"./packages/shared/utils"}]}' > tsconfig.json

# Build
RUN pnpm --filter @nachos/tool-code-runner build

# Create non-root user (1001 to avoid conflict with node:alpine built-in 'node' user at 1000)
RUN adduser -D -u 1001 coderunner && \
    mkdir -p /tmp && \
    chown -R coderunner:coderunner /tmp

# Switch to non-root user
USER coderunner

# LANGUAGE is set per-service in docker-compose (python or javascript)
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "process.exit(0)"

# Start the tool
WORKDIR /app/packages/tools/code-runner
CMD ["node", "dist/index.js"]
