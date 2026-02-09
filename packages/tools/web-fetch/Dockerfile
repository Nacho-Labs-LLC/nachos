# Web Fetch Tool Dockerfile
FROM node:22-alpine

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --production

# Copy built output
COPY dist ./dist

# Create non-root user
RUN addgroup -g 1000 nachos && \
    adduser -D -u 1000 -G nachos nachos

USER nachos

ENV NODE_ENV=production

# Basic health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "process.exit(0)"

CMD ["node", "dist/index.js"]
