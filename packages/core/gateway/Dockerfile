# ─── Stage: Go skill binaries ────────────────────────────────────────────────
# Compiles Go-based CLI tools declared in skills/Skillfile.
# Binaries are statically linked (CGO_ENABLED=0) for Alpine/Debian compat.
FROM golang:1.25-bookworm AS go-skills

COPY skills/Skillfile /tmp/Skillfile

# Install all Go-based skills from the Skillfile
# Create output dir so COPY --from never fails on empty glob
RUN mkdir -p /out/skills && \
    set -e; \
    grep '^go ' /tmp/Skillfile | while read -r _type _bin target; do \
      echo "Installing Go skill: $_bin from $target"; \
      CGO_ENABLED=0 go install "$target"; \
    done && \
    cp /go/bin/* /out/skills/ 2>/dev/null || true

# ─── Stage: Config builder ──────────────────────────────────────────────────
FROM node:22-slim AS config

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

# Build shared packages in dependency order
RUN pnpm --filter @nachos/types build && \
    pnpm --filter @nachos/config build

FROM node:22-slim AS development

# Install system dependencies, Go for CLI tools, and Chromium for browser tool
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    chromium \
    fonts-freefont-ttf \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Point playwright-core at system Chromium
ENV CHROME_BIN=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Copy pre-built Go skill binaries from builder stage
COPY --from=go-skills /out/skills/ /usr/local/bin/skills/

# Install npm-based skill CLI tools from Skillfile
COPY skills/Skillfile /tmp/Skillfile
RUN set -e; \
    grep '^npm ' /tmp/Skillfile | while read -r _type _bin target; do \
      echo "Installing npm skill: $_bin from $target"; \
      npm install -g "$target"; \
    done && rm /tmp/Skillfile

# Install Claude Code CLI for agent_exec capability
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user BEFORE any file copies
RUN groupadd -g 1001 nachos && \
    useradd -u 1001 -g nachos -s /bin/sh -m nachos

# Skill binaries on PATH
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

# Ensure skills directory exists (SKILL.md files copied via `COPY . .` above)
RUN mkdir -p /app/skills

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
