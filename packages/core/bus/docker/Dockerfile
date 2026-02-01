# ═══════════════════════════════════════════════════════════════════════════════
# NATS Message Bus Container
# ═══════════════════════════════════════════════════════════════════════════════
#
# This Dockerfile creates a lightweight NATS server container for the Nachos
# message bus. It uses the official NATS Alpine image with custom configuration.
#
# Usage:
#   docker build -t nachos/bus -f packages/core/bus/docker/Dockerfile .
#   docker run -p 4222:4222 -p 8222:8222 nachos/bus
#
# ═══════════════════════════════════════════════════════════════════════════════

FROM nats:2.10-alpine

# Copy custom configuration
COPY packages/core/bus/docker/nats.conf /etc/nats/nats.conf

# Expose NATS port for client connections and HTTP monitoring
EXPOSE 4222 8222

# Health check using NATS monitoring endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8222/healthz || exit 1

# Run NATS with custom config
CMD ["nats-server", "-c", "/etc/nats/nats.conf"]
