# Code Runner Dockerfile
# Combined Node.js + Python execution environment

FROM node:22-alpine

# Install Python 3
RUN apk add --no-cache python3

# Create non-root user early
RUN adduser -D -u 1001 coderunner && \
    mkdir -p /tmp /workspace && \
    chown coderunner:coderunner /workspace && \
    chown coderunner:coderunner /tmp

WORKDIR /app
RUN chown coderunner:coderunner /app
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

USER coderunner

# Copy with correct ownership
COPY --chown=coderunner:coderunner package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=coderunner:coderunner tsconfig.base.json tsconfig.json ./
COPY --chown=coderunner:coderunner packages/shared ./packages/shared
COPY --chown=coderunner:coderunner packages/tools/code-runner ./packages/tools/code-runner

RUN pnpm install --frozen-lockfile

# Provide minimal root tsconfig
RUN echo '{"extends":"./tsconfig.base.json","compilerOptions":{"composite":true},"files":[],"references":[{"path":"./packages/shared/types"},{"path":"./packages/shared/utils"},{"path":"./packages/shared/tool-base"}]}' > tsconfig.json

# Build dependencies first, then the tool
RUN pnpm --filter @nachos/types build && \
    pnpm --filter @nachos/utils build && \
    pnpm --filter @nachos/tool-base build && \
    pnpm --filter @nachos/tool-code-runner build

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "process.exit(0)"

WORKDIR /app/packages/tools/code-runner
CMD ["node", "dist/index.js"]
