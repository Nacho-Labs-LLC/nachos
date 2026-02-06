# Filesystem Tool Dockerfile
FROM node:22-alpine

# Create app directory
WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --production

# Copy source code
COPY dist ./dist

# Create non-root user
RUN addgroup -g 1000 nachos && \
    adduser -D -u 1000 -G nachos nachos

# Create workspace directory
RUN mkdir -p /workspace && chown nachos:nachos /workspace

# Switch to non-root user
USER nachos

# Set environment variables
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })" || exit 1

# Start the tool
CMD ["node", "dist/index.js"]
