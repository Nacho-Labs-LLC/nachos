# ─── Stage 1: Build frontend (Vue + Vite) ───────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /build
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY packages/core/admin/package.json ./packages/core/admin/
COPY packages/core/admin/tsconfig.json ./packages/core/admin/
COPY packages/core/admin/vite.config.ts ./packages/core/admin/
COPY packages/core/admin/frontend/ ./packages/core/admin/frontend/

RUN pnpm install --frozen-lockfile --filter @nachos/admin

WORKDIR /build/packages/core/admin
RUN pnpm build:frontend

# ─── Stage 2: Build backend (TypeScript) ─────────────────────────────────────
FROM node:22-alpine AS backend-builder

WORKDIR /build
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared/ ./packages/shared/
COPY packages/core/bus/ ./packages/core/bus/
COPY packages/core/admin/ ./packages/core/admin/

RUN pnpm install --frozen-lockfile --filter @nachos/admin...

WORKDIR /build/packages/core/admin
RUN pnpm build:backend

# ─── Stage 3: Runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Create non-root user first
RUN addgroup -g 1001 nachos && adduser -D -u 1001 -G nachos nachos \
 && (addgroup -g 999 docker 2>/dev/null || true) \
 && (adduser nachos docker 2>/dev/null || true)

WORKDIR /app
RUN chown nachos:nachos /app
RUN corepack enable && corepack prepare pnpm@latest --activate

USER nachos

# Copy workspace manifests for production install
COPY --chown=nachos:nachos package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY --chown=nachos:nachos tsconfig.base.json ./
COPY --chown=nachos:nachos packages/core/admin/package.json ./packages/core/admin/
COPY --chown=nachos:nachos packages/shared/config/package.json ./packages/shared/config/
COPY --chown=nachos:nachos packages/shared/types/package.json ./packages/shared/types/
COPY --chown=nachos:nachos packages/core/bus/package.json ./packages/core/bus/

# Production deps for admin + its workspace dependencies
RUN pnpm install --frozen-lockfile --prod --filter @nachos/admin...

# Copy built artifacts (already correct ownership via --chown)
COPY --from=backend-builder --chown=nachos:nachos /build/packages/core/admin/dist/ ./packages/core/admin/dist/
COPY --from=frontend-builder --chown=nachos:nachos /build/packages/core/admin/dist/public/ ./packages/core/admin/dist/public/
# Copy compiled workspace dependencies
COPY --from=backend-builder --chown=nachos:nachos /build/packages/shared/config/dist/ ./packages/shared/config/dist/
COPY --from=backend-builder --chown=nachos:nachos /build/packages/shared/types/dist/ ./packages/shared/types/dist/
COPY --from=backend-builder --chown=nachos:nachos /build/packages/core/bus/dist/ ./packages/core/bus/dist/

EXPOSE 8082

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:8082/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/packages/core/admin
CMD ["node", "dist/server.js"]
