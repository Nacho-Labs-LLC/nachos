# ─── Stage 1: Build frontend (Vue + Vite) ───────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /build

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace root manifests (needed for workspace resolution)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json ./

# Copy admin package
COPY packages/core/admin/package.json ./packages/core/admin/
COPY packages/core/admin/vite.config.ts ./packages/core/admin/
COPY packages/core/admin/frontend/ ./packages/core/admin/frontend/

# Install only frontend deps (no hoisting needed for build)
RUN pnpm install --frozen-lockfile --filter @nachos/admin

WORKDIR /build/packages/core/admin

RUN pnpm build:frontend

# ─── Stage 2: Build backend (TypeScript) ─────────────────────────────────────
FROM node:22-alpine AS backend-builder

WORKDIR /build

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY packages/core/admin/ ./packages/core/admin/

RUN pnpm install --frozen-lockfile --filter @nachos/admin

WORKDIR /build/packages/core/admin

RUN pnpm build:backend

# ─── Stage 3: Runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests for production install
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY packages/core/admin/package.json ./packages/core/admin/

# Production deps only
RUN pnpm install --frozen-lockfile --prod --filter @nachos/admin

# Copy built artifacts
COPY --from=backend-builder /build/packages/core/admin/dist/ ./packages/core/admin/dist/
COPY --from=frontend-builder /build/packages/core/admin/dist/public/ ./packages/core/admin/dist/public/

# Security: non-root user + docker group access for socket
RUN addgroup -g 1001 nachos && adduser -D -u 1001 -G nachos nachos \
 && addgroup -g 999 docker && adduser nachos docker
USER nachos

EXPOSE 8082

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:8082/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/packages/core/admin

CMD ["node", "dist/server.js"]
