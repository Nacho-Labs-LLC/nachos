# Browser Tool Dockerfile
# Based on official Playwright image with Chrome pre-installed
FROM mcr.microsoft.com/playwright:v1.40.0-focal

# Create app directory
WORKDIR /app

# Install Node.js dependencies
COPY package.json ./
RUN npm install --production

# Copy source code
COPY dist ./dist

# Create non-root user (playwright image already has 'pwuser')
# Create workspace and downloads directories
RUN mkdir -p /workspace /downloads && \
    chown pwuser:pwuser /workspace /downloads

# Switch to non-root user
USER pwuser

# Set environment variables
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "process.exit(0)"

# Start the tool
CMD ["node", "dist/index.js"]
