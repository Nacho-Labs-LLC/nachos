FROM nats:2.10-alpine

# NATS will be used as-is from the official image
# Configuration will be provided via docker-compose volumes

EXPOSE 4222 8222

# Health check for NATS
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8222/healthz || exit 1
