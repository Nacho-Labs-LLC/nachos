# Docker Infrastructure

This directory contains Docker configurations for Nachos development and production environments.

## Structure

```
docker/
├── Dockerfile.base           # Base multi-stage Dockerfile template
├── nats/
│   └── nats-server.conf     # NATS message bus configuration
└── README.md                # This file
```

## Development Setup

### Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- At least 4GB RAM allocated to Docker

### Quick Start

1. **Copy environment variables:**
   ```bash
   cp .env.example .env
   ```

2. **Add your LLM API key(s) to `.env`:**
   ```bash
   # Edit .env and add your keys
   ANTHROPIC_API_KEY=sk-ant-...
   # or
   OPENAI_API_KEY=sk-...
   ```

3. **Start the stack:**
   ```bash
   docker compose -f docker-compose.dev.yml up
   ```

4. **Verify all services are healthy:**
   ```bash
   docker compose -f docker-compose.dev.yml ps
   ```

All services should show as "healthy" after ~10-15 seconds.

### Services

The development stack includes:

| Service    | Port | Description                    |
|------------|------|--------------------------------|
| bus        | 4222 | NATS message bus (client)      |
| bus        | 8222 | NATS monitoring HTTP endpoint  |
| gateway    | 3000 | Gateway service                |
 | llm-proxy  | 3001 | LLM provider abstraction       |
 | redis      | 6379 | Shared state for rate limits   |

### Hot Reload

All services use `tsx watch` to automatically reload when source files change:

- Source code is mounted as read-only volumes
- Changes to `.ts` files trigger immediate reload
- No need to rebuild containers during development

**What triggers reload:**
- Any `.ts` file in `packages/core/*/src/`
- Any `.ts` file in `packages/shared/`
- TypeScript config changes

**What doesn't trigger reload:**
- `package.json` changes (requires rebuild)
- `Dockerfile` changes (requires rebuild)

### Logs

View aggregated logs from all services:

```bash
# All services
docker compose -f docker-compose.dev.yml logs -f

# Specific service
docker compose -f docker-compose.dev.yml logs -f gateway

# Last 100 lines
docker compose -f docker-compose.dev.yml logs --tail=100

# Filter by service
docker compose -f docker-compose.dev.yml logs -f gateway llm-proxy
```

Logs are also written to a shared volume at `/var/log/nachos` inside containers.

### Networks

Two Docker networks are created:

#### `nachos-internal` (172.20.0.0/16)
- **Isolated** - no external access
- All core services communicate here
 - Used for: gateway, bus, redis, safe tools

#### `nachos-egress` (172.21.0.0/16)
- **External access** allowed
- Only services that need internet join this
- Used for: llm-proxy, channel adapters, browser tool

### Stopping Services

```bash
# Stop all services
docker compose -f docker-compose.dev.yml down

# Stop and remove volumes (clean slate)
docker compose -f docker-compose.dev.yml down -v

# Stop specific service
docker compose -f docker-compose.dev.yml stop gateway
```

### Rebuilding

After changes to `package.json` or `Dockerfile`:

```bash
# Rebuild all services
docker compose -f docker-compose.dev.yml build

# Rebuild specific service
docker compose -f docker-compose.dev.yml build gateway

# Rebuild without cache
docker compose -f docker-compose.dev.yml build --no-cache
```

### Troubleshooting

#### Services won't start

1. Check if ports are already in use:
   ```bash
   lsof -i :3000  # or 3001, 3002, 4222, 8222
   ```

2. Check Docker resources:
   ```bash
   docker system df
   docker system prune  # if needed
   ```

3. View detailed logs:
   ```bash
   docker compose -f docker-compose.dev.yml logs gateway
   ```

#### Hot reload not working

1. Verify volumes are mounted:
   ```bash
   docker compose -f docker-compose.dev.yml config
   ```

2. Check file permissions:
   ```bash
   ls -la packages/core/gateway/src
   ```

3. Restart the service:
   ```bash
   docker compose -f docker-compose.dev.yml restart gateway
   ```

#### Container is unhealthy

```bash
# Check health status
docker inspect nachos-gateway | grep -A 10 Health

# Restart unhealthy service
docker compose -f docker-compose.dev.yml restart gateway
```

## Network Isolation Testing

Verify that internal network is truly isolated:

```bash
# This should FAIL (no internet in internal network)
docker compose -f docker-compose.dev.yml exec gateway ping -c 1 8.8.8.8

# This should SUCCEED (egress network has internet)
docker compose -f docker-compose.dev.yml exec llm-proxy ping -c 1 8.8.8.8
```

## Performance

### Target Metrics

- **Startup time**: < 30 seconds for all services
- **Hot reload**: < 2 seconds after file change
- **Memory usage**: < 512MB per service
- **CPU usage**: < 25% per service at idle

### Monitoring

```bash
# Watch resource usage
docker stats

# Check startup time
time docker compose -f docker-compose.dev.yml up -d
```

## Production Build

For production deployments, use the multi-stage Dockerfile:

```bash
docker build \
  --target production \
  -f docker/Dockerfile.base \
  -t nachos-gateway:prod \
  --build-arg SERVICE=gateway \
  .
```

Production images:
- Use `node:22-alpine` (minimal size)
- Run as non-root user (UID 1001)
- Have read-only filesystem
- Include health checks
- Use dumb-init for signal handling

## Security

### Container Security

All containers follow security best practices:

- ✅ Non-root user (UID 1001)
- ✅ Minimal base image (Alpine)
- ✅ No unnecessary packages
- ✅ Health checks enabled
- ✅ Resource limits set
- ✅ Read-only root filesystem (production)
- ✅ Dropped capabilities (production)

### Network Security

- Internal network is fully isolated
- Egress network is explicitly granted
- No unnecessary ports exposed
- Communication uses internal DNS

## Contributing

When adding new services:

1. Create service-specific Dockerfile
2. Add service to `docker-compose.dev.yml`
3. Configure hot-reload with volume mounts
4. Add health check
5. Set resource limits
6. Update this README

## Resources

- [Docker Compose Docs](https://docs.docker.com/compose/)
- [NATS Documentation](https://docs.nats.io/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
