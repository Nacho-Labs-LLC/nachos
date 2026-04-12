FROM nats:2.10-alpine

# Create non-root user for NATS
RUN addgroup -g 1000 -S nats && \
    adduser -u 1000 -S -G nats -h /home/nats nats && \
    mkdir -p /data/jetstream && \
    chown -R nats:nats /data

# Copy NATS configuration into the image
COPY docker/nats/nats-server.conf /etc/nats/nats-server.conf

EXPOSE 4222 8222

# Run as non-root nats user
# NOTE: If upgrading from a root-based install, remove the old volume:
#   docker volume rm nachos-core_nats-data
USER nats

# Health check for NATS
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8222/healthz || exit 1
