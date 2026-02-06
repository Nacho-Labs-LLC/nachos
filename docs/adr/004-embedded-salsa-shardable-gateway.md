# ADR-004: Embedded Salsa & Shardable Gateway Architecture

**Status**: Accepted

**Date**: 2026-02-01

**Implemented**: 2026-02-06

**Deciders**: Nachos Core Team

**Context**: Security layer deployment model and horizontal scaling strategy

---

## Context and Problem Statement

The original Nachos architecture (ADR-003) defined Salsa as a separate container that the Gateway communicates with via the message bus. As we refine the architecture, we need to decide:

1. Should Salsa remain a separate container or be embedded in Gateway?
2. How do we support horizontal scaling of the Gateway?
3. How do we manage shared state (rate limits, session routing) across instances?

These decisions are interconnected: embedding Salsa affects how we scale, and scaling affects how we manage state.

## Decision Drivers

- **Latency**: Policy checks happen on every request; network hops add latency
- **Operational simplicity**: Fewer containers = easier deployment for personal use
- **Horizontal scaling**: Users may want to run multiple Gateway instances
- **State consistency**: Rate limits and session routing must be consistent across instances
- **Docker-native**: Solution should work well in Docker Compose environment
- **Failure isolation**: Security layer failures shouldn't cascade unpredictably

## Considered Options

### Option 1: Salsa as Separate Container (Current Design)

Keep Salsa as its own service, communicating via NATS.

```
Gateway ──NATS──> Salsa ──NATS──> Gateway
```

**Pros:**

- Clear separation of concerns
- Can scale Salsa independently
- Failure isolation (Salsa crash doesn't kill Gateway)
- Matches microservice conventions

**Cons:**

- Network latency on every policy check (~2-5ms)
- Additional container to manage
- More complex deployment
- NATS becomes critical path for security
- Overkill for single-user personal assistant

### Option 2: Salsa Embedded in Gateway

Salsa becomes a library/module within Gateway, called directly.

```
┌─────────────────────────┐
│        Gateway          │
│  ┌───────────────────┐  │
│  │      Salsa        │  │
│  │  (embedded lib)   │  │
│  └───────────────────┘  │
└─────────────────────────┘
```

**Pros:**

- Zero network latency for policy checks (<0.1ms)
- One fewer container to deploy
- Simpler operational model
- Policy hot-reload still works (file watching)
- Gateway is self-contained security unit

**Cons:**

- Salsa bug could crash Gateway
- Can't scale policy engine independently
- Tighter coupling

### Option 3: Hybrid - Embedded with Optional Sidecar

Embed Salsa by default, but support external Salsa for advanced deployments.

**Pros:**

- Best of both worlds
- Progressive complexity

**Cons:**

- Two code paths to maintain
- Configuration complexity
- Unlikely to be used for personal assistant

## Decision Outcome

**Chosen option**: Option 2 - Salsa Embedded in Gateway

### Rationale

For a personal AI assistant framework:

1. **Latency matters**: Every user message triggers multiple policy checks. Eliminating network hops improves responsiveness noticeably.

2. **Simplicity wins**: Users deploy fewer containers. `docker-compose up` starts a working system faster.

3. **Failure coupling is acceptable**: If the security layer fails, the Gateway *should* stop processing requests. Fail-closed is the right behavior.

4. **Scaling is still possible**: We handle horizontal scaling at the Gateway level, not by scaling Salsa separately.

5. **Hot-reload preserved**: Policies in `policies/*.yaml` are still file-watched and reloaded without restart.

---

## Horizontal Scaling: Hybrid Session Sharding

With Salsa embedded, horizontal scaling means running multiple Gateway instances. This requires solving:

- Session state consistency
- Rate limit state sharing
- Request routing

### Chosen Approach: Hybrid Sharding

```
┌─────────────────────────────────────────────────────────────────┐
│                        Load Balancer                             │
│                   (sticky routing by user)                       │
└─────────────────────────────────────────────────────────────────┘
                    │                    │
         ┌──────────▼──────────┐ ┌──────▼──────────────┐
         │   Gateway-1         │ │   Gateway-2          │
         │   ┌─────────────┐   │ │   ┌─────────────┐   │
         │   │ SQLite      │   │ │   │ SQLite      │   │
         │   │ (local)     │   │ │   │ (local)     │   │
         │   └─────────────┘   │ │   └─────────────┘   │
         └─────────┬───────────┘ └──────────┬──────────┘
                   │                        │
                   └──────────┬─────────────┘
                              ▼
                    ┌─────────────────┐
                    │     Redis       │
                    │  - rate limits  │
                    │  - session map  │
                    │  - session sync │
                    └─────────────────┘
```

**How it works:**

1. **Sticky routing (default)**: Load balancer routes requests by user ID hash. Most requests hit the same Gateway instance.

2. **Local SQLite**: Each Gateway maintains its own SQLite for fast session reads. No network latency for session lookups.

3. **Redis for shared state**:
   - Rate limit counters (sliding window)
   - Session ownership map (which Gateway owns which session)
   - Session sync queue (for migrations)

4. **Session migration**: When rebalancing load:
   - Update session map in Redis
   - Source Gateway pushes session to Redis
   - Target Gateway pulls and caches locally
   - ~100ms migration latency (acceptable)

5. **Instance failure recovery**:
   - Gateway periodically snapshots active sessions to Redis
   - On failure, sessions are marked orphaned
   - Next Gateway to receive request recovers from snapshot

### Why Hybrid Over Alternatives

| Approach | Latency | Complexity | Failure Recovery |
|----------|---------|------------|------------------|
| Sticky only | Best | Lowest | Poor (sessions lost) |
| Shared DB (Postgres) | +5-10ms | Medium | Good |
| **Hybrid** | Best | Medium | Good |
| Full distributed | +2-5ms | Highest | Best |

Hybrid gives us fast local reads (SQLite) with good failure recovery (Redis snapshots), without requiring PostgreSQL.

---

## Implementation

### Package Structure

```
packages/core/gateway/
  src/
    index.ts
    config.ts
    router.ts
    session/
      manager.ts
      store.ts           # SQLite local store
      sync.ts            # Redis session sync
    salsa/               # Embedded Salsa module
      index.ts           # Main Salsa API
      policy/
        engine.ts        # Policy evaluation
        loader.ts        # YAML policy loading
        watcher.ts       # Hot-reload
      dlp/
        scanner.ts       # DLP integration
        patterns.ts      # Pattern loading
      rate-limit/
        limiter.ts       # Sliding window impl
        redis-store.ts   # Redis backend
      audit/
        logger.ts        # Audit interface
        providers/       # Pluggable providers
          sqlite.ts
          file.ts
          index.ts
    health.ts
```

### Configuration

```toml
[security]
mode = "standard"

[security.rate_limits]
requests_per_minute = 60
tokens_per_hour = 100000

[security.dlp]
enabled = true
action = "redact"  # block | redact | alert
custom_patterns = "./policies/dlp-patterns.yaml"

[security.audit]
provider = "sqlite"  # sqlite | file | loki | custom
path = "./data/audit.db"

[runtime]
# For horizontal scaling
redis_url = "redis://localhost:6379"
instance_id = "auto"  # auto-generated or explicit
```

### Salsa API (Internal)

```typescript
// packages/core/gateway/src/salsa/index.ts

export interface SalsaConfig {
  mode: 'strict' | 'standard' | 'permissive'
  policiesPath: string
  redisUrl?: string
  auditProvider: AuditProvider
}

export class Salsa {
  private policy: PolicyEngine
  private dlp: DLPScanner
  private rateLimiter: RateLimiter
  private audit: AuditLogger

  constructor(config: SalsaConfig)

  /**
   * Evaluate a request against all security layers
   * Called synchronously on every action
   */
  async evaluate(request: SecurityRequest): Promise<SecurityResult> {
    // 1. DLP scan
    const dlpResult = await this.dlp.scan(request.content)
    if (dlpResult.blocked) {
      await this.audit.log({ type: 'dlp_block', ...dlpResult })
      return { allowed: false, reason: 'dlp_blocked' }
    }

    // 2. Rate limit check
    const rateResult = await this.rateLimiter.check(request.userId, request.action)
    if (rateResult.limited) {
      await this.audit.log({ type: 'rate_limited', ...rateResult })
      return { allowed: false, reason: 'rate_limited', retryAfter: rateResult.retryAfter }
    }

    // 3. Policy evaluation
    const policyResult = await this.policy.evaluate(request)
    await this.audit.log({ type: 'policy_check', ...policyResult })

    return policyResult
  }

  /**
   * Reload policies from disk (called by file watcher)
   */
  async reloadPolicies(): Promise<void>
}
```

### Docker Compose Changes

```yaml
services:
  gateway:
    build: ./packages/core/gateway
    environment:
      - REDIS_URL=redis://redis:6379
      - SECURITY_MODE=standard
    volumes:
      - ./policies:/app/policies:ro
      - ./data/gateway:/app/data
    depends_on:
      - bus
      - redis

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 3
    networks:
      - nachos-internal

  # salsa service REMOVED - now embedded in gateway

volumes:
  redis-data:
```

---

## Consequences

**Positive:**

- Faster policy checks (~100x improvement: 2ms → 0.02ms)
- Simpler deployment (one fewer container)
- Gateway is a self-contained secure unit
- Horizontal scaling supported via Redis
- Session migration enables load balancing
- Failure recovery via Redis snapshots

**Negative:**

- Salsa bugs can crash Gateway (mitigated by fail-closed design)
- Redis becomes required for multi-instance deployments
- More complex Gateway codebase
- Session migration adds ~100ms latency when it occurs

**Neutral:**

- Single-instance deployments work without Redis (optional dependency)
- Policy hot-reload works the same as before
- Security modes unchanged from ADR-003

---

## Validation

Success metrics:

- Policy check latency <1ms p99
- Session migration <200ms p99
- Zero security bypasses
- Successful failover in <5s

---

## References

- [ADR-003: Security-First Design](./003-security-first-design.md)
- [Redis Sliding Window Rate Limiting](https://redis.io/glossary/rate-limiting/)
- [SQLite as Application File Format](https://sqlite.org/appfileformat.html)
- Discussion: GitHub Issue #TBD
