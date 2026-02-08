# GitHub Copilot CLI Tool Dockerfile
FROM node:22-alpine

# Install GitHub CLI
RUN apk add --no-cache github-cli

# Create app directory
WORKDIR /app

# Install Node.js dependencies
COPY package.json ./
RUN npm install --production

# Copy source code
COPY dist ./dist

# Create non-root user
RUN adduser -D -u 1000 copilot && \
    chown -R copilot:copilot /app

# Switch to non-root user
USER copilot

# Set environment variables
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "process.exit(0)"

# Start the tool
CMD ["node", "dist/index.js"]
