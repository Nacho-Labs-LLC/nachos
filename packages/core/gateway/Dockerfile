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
RUN go install github.com/steipete/goplaces/cmd/goplaces@latest && \
    go install github.com/steipete/gifgrep/cmd/gifgrep@latest && \
    go install github.com/steipete/gogcli/cmd/gog@latest

# Install Node-based skill CLI tools
RUN npm install -g @steipete/summarize

# Add Go binaries to PATH
ENV PATH="/root/go/bin:${PATH}"

# Create non-root user
RUN addgroup -g 1001 -S nachos && \
    adduser -S nachos -u 1001 -G nachos

# Copy Go binaries to a location accessible by nachos user
RUN mkdir -p /usr/local/bin/skills && \
    cp /root/go/bin/* /usr/local/bin/skills/ 2>/dev/null || true && \
    chmod +x /usr/local/bin/skills/* && \
    chown -R nachos:nachos /usr/local/bin/skills

# Update PATH for nachos user
ENV PATH="/usr/local/bin/skills:${PATH}"

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.json ./

# Copy shared packages
COPY packages/shared ./packages/shared

# Copy core packages used by gateway
COPY packages/core/bus ./packages/core/bus
COPY packages/core/gateway ./packages/core/gateway

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Change ownership
RUN chown -R nachos:nachos /app

USER nachos

# Expose port (gateway will listen on this)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "process.exit(0)" || exit 1

# Start in development mode with tsx watch for hot-reload
WORKDIR /app/packages/core/gateway
CMD ["npx", "tsx", "watch", "src/main.ts"]
