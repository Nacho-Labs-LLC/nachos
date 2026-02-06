# JavaScript Code Runner Dockerfile
# Sandboxed Node.js execution environment

FROM node:22-alpine

# Create app directory
WORKDIR /app

# Install Node.js dependencies
COPY package.json ./
RUN npm install --production

# Copy source code
COPY dist ./dist

# Create non-root user
RUN adduser -D -u 1000 coderunner && \
    mkdir -p /tmp && \
    chown -R coderunner:coderunner /tmp

# Switch to non-root user
USER coderunner

# Set environment variables
ENV NODE_ENV=production
ENV LANGUAGE=javascript

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "process.exit(0)"

# Start the tool
CMD ["node", "dist/index.js"]
