# Filesystem Tool Dockerfile
FROM node:22-alpine

# Create app directory
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.json ./

# Copy shared packages (workspace deps)
COPY packages/shared ./packages/shared

# Copy tool package
COPY packages/tools/filesystem ./packages/tools/filesystem

# Install dependencies
RUN pnpm install --frozen-lockfile

# Provide minimal root tsconfig (avoids references to packages not in this image)
RUN echo '{"extends":"./tsconfig.base.json","compilerOptions":{"composite":true},"files":[],"references":[{"path":"./packages/shared/types"},{"path":"./packages/shared/utils"}]}' > tsconfig.json

# Build
RUN pnpm --filter @nachos/tool-filesystem build

# Create non-root user (1001 to avoid conflict with node:alpine built-in 'node' user at 1000)
RUN addgroup -g 1001 nachos && \
    adduser -D -u 1001 -G nachos nachos

# Create workspace directory
RUN mkdir -p /workspace && chown nachos:nachos /workspace

# Switch to non-root user
USER nachos

# Set environment variables
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "process.exit(0)"

# Start the tool
WORKDIR /app/packages/tools/filesystem
CMD ["node", "dist/index.js"]
