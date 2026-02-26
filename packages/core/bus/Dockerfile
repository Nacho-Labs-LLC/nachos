FROM nats:2.10-alpine

# Copy NATS configuration into the image
COPY docker/nats/nats-server.conf /etc/nats/nats-server.conf

EXPOSE 4222 8222

# Health check for NATS
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8222/healthz || exit 1
