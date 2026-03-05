FROM node:22-alpine AS config

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.json ./

# Copy shared config package
COPY packages/shared/config ./packages/shared/config
COPY packages/shared/types ./packages/shared/types
COPY packages/shared/utils ./packages/shared/utils

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build config package
RUN pnpm --filter @nachos/config build

FROM node:22-alpine AS development

# Install system dependencies, Go for CLI tools, and Chromium for browser tool
RUN apk add --no-cache \
    go \
    git \
    ca-certificates \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

# Point playwright-core at Alpine's Chromium
ENV CHROME_BIN=/usr/bin/chromium-browser
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Install Go-based skill CLI tools
# Pin skill CLI tool versions for reproducible builds (last updated 2026-03-05)
RUN go install github.com/steipete/goplaces/cmd/goplaces@v0.3.0 && \
    go install github.com/steipete/gifgrep/cmd/gifgrep@v0.2.3 && \
    go install github.com/steipete/gogcli/cmd/gog@v0.11.0

# Install Node-based skill CLI tools
RUN npm install -g @steipete/summarize@0.11.1

# Create non-root user BEFORE any file copies
RUN addgroup -g 1001 -S nachos && \
    adduser -S nachos -u 1001 -G nachos

# Copy Go binaries to a shared location
RUN mkdir -p /usr/local/bin/skills && \
    cp /root/go/bin/* /usr/local/bin/skills/ 2>/dev/null || true && \
    chmod +x /usr/local/bin/skills/*

# Update PATH for nachos user
ENV PATH="/usr/local/bin/skills:${PATH}"

WORKDIR /app
RUN chown nachos:nachos /app

# Install pnpm (as root, it's a global tool)
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# Switch to nachos user — all subsequent COPY/RUN happen as nachos
USER nachos

# Copy workspace config (--chown avoids expensive chown -R later)
COPY --chown=nachos:nachos package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=nachos:nachos tsconfig.base.json tsconfig.json ./

# Copy shared packages
COPY --chown=nachos:nachos packages/shared ./packages/shared

# Copy core packages used by gateway
COPY --chown=nachos:nachos packages/core/bus ./packages/core/bus
COPY --chown=nachos:nachos packages/core/gateway ./packages/core/gateway

# Install dependencies (runs as nachos, files created with correct ownership)
RUN pnpm install --frozen-lockfile

# Copy remaining source code
COPY --chown=nachos:nachos . .

# Create skills directory (prevents scandir error at runtime)
RUN mkdir -p /app/packages/skills

# Copy prebuilt config dist from shared builder
COPY --from=config --chown=nachos:nachos /app/packages/shared/config/dist ./packages/shared/config/dist

# Build all workspace dependencies
RUN pnpm --filter @nachos/types build && \
    pnpm --filter @nachos/utils build && \
    pnpm --filter @nachos/context-manager build && \
    pnpm --filter @nachos/bus build

# Expose port (gateway will listen on this)
EXPOSE 3000

# Health check — use port 3000 (health server)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start in development mode with tsx watch for hot-reload
WORKDIR /app/packages/core/gateway
CMD ["npx", "tsx", "watch", "src/main.ts"]
