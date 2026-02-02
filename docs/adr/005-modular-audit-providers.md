# ADR-005: Modular Audit Provider System

**Status**: Proposed

**Date**: 2026-02-01

**Deciders**: Nachos Core Team

**Context**: Audit logging architecture and extensibility

---

## Context and Problem Statement

Nachos requires comprehensive audit logging for security compliance and debugging. Different users have different requirements:

- Personal users: Simple file or SQLite logging
- Enterprise users: Integration with Loki, Elasticsearch, Splunk
- Privacy-conscious users: Local-only, encrypted logs
- Developers: Console output during development

We need an audit system that:
1. Works out of the box with sensible defaults
2. Supports user-provided logging backends
3. Maintains consistent event schema across all providers

## Decision Drivers

- **Zero-config default**: Must work immediately without setup
- **Extensibility**: Users can add custom providers
- **Consistency**: Same event schema regardless of provider
- **Performance**: Audit logging shouldn't slow down requests
- **Reliability**: Audit events must not be lost silently
- **Simplicity**: Plugin interface must be easy to implement

## Considered Options

### Option 1: Single Built-in Provider (SQLite)

Hardcode SQLite as the only audit backend.

**Pros:**

- Simplest implementation
- No abstraction overhead
- Works offline

**Cons:**

- No flexibility
- Users must export/transform for external tools
- Doesn't scale for high-volume deployments

### Option 2: Configuration-Based Provider Selection

Support multiple built-in providers, selected via config.

```toml
[security.audit]
provider = "sqlite"  # or "file", "loki", "elasticsearch"
```

**Pros:**

- Covers common use cases
- No plugin complexity
- Type-safe configuration

**Cons:**

- Can't add new providers without code changes
- Must maintain all provider implementations
- Bloats core package with provider dependencies

### Option 3: Plugin Architecture

Define an `AuditProvider` interface that users can implement.

**Pros:**

- Maximum flexibility
- Core stays lean
- Community can contribute providers
- Users can integrate with any system

**Cons:**

- More complex interface design
- Need plugin loading mechanism
- Documentation burden

### Option 4: Hybrid - Built-in + Plugin Support

Ship common providers, allow custom plugins.

**Pros:**

- Works out of the box (SQLite default)
- Common providers included (file, Loki)
- Custom providers possible
- Best of all worlds

**Cons:**

- Most complex to implement
- Multiple code paths

## Decision Outcome

**Chosen option**: Option 4 - Hybrid with Built-in + Plugin Support

### Rationale

1. **Zero-config works**: SQLite provider ships as default, no setup needed
2. **Common cases covered**: File and webhook providers built-in
3. **Extensible**: Interface is simple enough for custom providers
4. **Future-proof**: Can add more built-in providers based on demand

---

## Implementation

### Audit Event Schema

All providers receive the same event structure:

```typescript
// packages/core/gateway/src/salsa/audit/types.ts

export interface AuditEvent {
  id: string                    // UUID
  timestamp: string             // ISO 8601
  instanceId: string            // Gateway instance

  // Who
  userId: string
  sessionId: string
  channel: string

  // What
  eventType: AuditEventType
  action: string                // e.g., "tool.filesystem.write"
  resource?: string             // e.g., "/workspace/file.txt"

  // Outcome
  outcome: 'allowed' | 'denied' | 'blocked' | 'error'
  reason?: string               // Why denied/blocked

  // Context
  securityMode: 'strict' | 'standard' | 'permissive'
  policyMatched?: string        // Which policy rule matched

  // Details (varies by event type)
  details?: Record<string, unknown>
}

export type AuditEventType =
  | 'policy_check'
  | 'dlp_scan'
  | 'dlp_block'
  | 'rate_limit'
  | 'session_create'
  | 'session_end'
  | 'tool_execute'
  | 'llm_request'
  | 'config_reload'
  | 'error'
```

### Provider Interface

```typescript
// packages/core/gateway/src/salsa/audit/provider.ts

export interface AuditProvider {
  /**
   * Provider name for logging/debugging
   */
  readonly name: string

  /**
   * Initialize the provider (connect to DB, open file, etc.)
   * Called once at startup
   */
  init(): Promise<void>

  /**
   * Log an audit event
   * Should not throw - log errors internally and continue
   */
  log(event: AuditEvent): Promise<void>

  /**
   * Flush any buffered events
   * Called periodically and on shutdown
   */
  flush(): Promise<void>

  /**
   * Clean up resources
   * Called on shutdown
   */
  close(): Promise<void>

  /**
   * Optional: Query events (for built-in providers)
   */
  query?(filter: AuditQueryFilter): Promise<AuditEvent[]>
}

export interface AuditQueryFilter {
  startTime?: string
  endTime?: string
  userId?: string
  sessionId?: string
  eventType?: AuditEventType
  outcome?: string
  limit?: number
  offset?: number
}
```

### Built-in Providers

#### SQLite Provider (Default)

```typescript
// packages/core/gateway/src/salsa/audit/providers/sqlite.ts

export class SQLiteAuditProvider implements AuditProvider {
  readonly name = 'sqlite'
  private db: Database
  private buffer: AuditEvent[] = []
  private flushInterval: NodeJS.Timeout

  constructor(private config: { path: string; flushIntervalMs?: number }) {}

  async init(): Promise<void> {
    this.db = new Database(this.config.path)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        event_type TEXT NOT NULL,
        action TEXT NOT NULL,
        resource TEXT,
        outcome TEXT NOT NULL,
        reason TEXT,
        security_mode TEXT NOT NULL,
        policy_matched TEXT,
        details TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_events(session_id);
    `)

    // Periodic flush
    this.flushInterval = setInterval(
      () => this.flush(),
      this.config.flushIntervalMs ?? 5000
    )
  }

  async log(event: AuditEvent): Promise<void> {
    this.buffer.push(event)
    if (this.buffer.length >= 100) {
      await this.flush()
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return

    const events = this.buffer.splice(0)
    const stmt = this.db.prepare(`
      INSERT INTO audit_events
      (id, timestamp, instance_id, user_id, session_id, channel,
       event_type, action, resource, outcome, reason,
       security_mode, policy_matched, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insert = this.db.transaction((events: AuditEvent[]) => {
      for (const e of events) {
        stmt.run(
          e.id, e.timestamp, e.instanceId, e.userId, e.sessionId, e.channel,
          e.eventType, e.action, e.resource, e.outcome, e.reason,
          e.securityMode, e.policyMatched, JSON.stringify(e.details)
        )
      }
    })

    insert(events)
  }

  async query(filter: AuditQueryFilter): Promise<AuditEvent[]> {
    // Build query from filter...
  }

  async close(): Promise<void> {
    clearInterval(this.flushInterval)
    await this.flush()
    this.db.close()
  }
}
```

#### File Provider (JSON Lines)

```typescript
// packages/core/gateway/src/salsa/audit/providers/file.ts

export class FileAuditProvider implements AuditProvider {
  readonly name = 'file'
  private stream: WriteStream
  private buffer: string[] = []

  constructor(private config: {
    path: string
    rotateSize?: number  // bytes, default 10MB
    maxFiles?: number    // default 5
  }) {}

  async init(): Promise<void> {
    await this.openStream()
  }

  async log(event: AuditEvent): Promise<void> {
    this.buffer.push(JSON.stringify(event))
    if (this.buffer.length >= 50) {
      await this.flush()
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return
    const lines = this.buffer.splice(0).join('\n') + '\n'
    await this.stream.write(lines)
    await this.checkRotation()
  }

  // ... rotation logic
}
```

#### Webhook Provider

```typescript
// packages/core/gateway/src/salsa/audit/providers/webhook.ts

export class WebhookAuditProvider implements AuditProvider {
  readonly name = 'webhook'
  private buffer: AuditEvent[] = []

  constructor(private config: {
    url: string
    headers?: Record<string, string>
    batchSize?: number
    flushIntervalMs?: number
  }) {}

  async log(event: AuditEvent): Promise<void> {
    this.buffer.push(event)
    if (this.buffer.length >= (this.config.batchSize ?? 50)) {
      await this.flush()
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return

    const events = this.buffer.splice(0)
    try {
      await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers
        },
        body: JSON.stringify({ events })
      })
    } catch (err) {
      // Log error but don't throw - audit shouldn't break the system
      console.error('Webhook audit failed:', err)
      // Optionally: write to fallback local file
    }
  }
}
```

### Custom Provider Loading

Users can provide custom providers via a JavaScript/TypeScript file:

```typescript
// packages/core/gateway/src/salsa/audit/loader.ts

export async function loadAuditProvider(
  config: AuditConfig
): Promise<AuditProvider> {
  switch (config.provider) {
    case 'sqlite':
      return new SQLiteAuditProvider({ path: config.path })

    case 'file':
      return new FileAuditProvider({ path: config.path })

    case 'webhook':
      return new WebhookAuditProvider({
        url: config.url!,
        headers: config.headers
      })

    case 'custom':
      // Load from user-provided path
      const module = await import(config.customPath!)
      const Provider = module.default || module.AuditProvider
      return new Provider(config.customConfig)

    default:
      throw new Error(`Unknown audit provider: ${config.provider}`)
  }
}
```

### Configuration

```toml
[security.audit]
# Built-in providers
provider = "sqlite"
path = "./data/audit.db"

# Or file-based
# provider = "file"
# path = "./logs/audit.jsonl"
# rotate_size = 10485760  # 10MB
# max_files = 5

# Or webhook
# provider = "webhook"
# url = "https://my-loki-instance/loki/api/v1/push"
# headers = { "X-API-Key" = "secret" }

# Or custom
# provider = "custom"
# custom_path = "./my-audit-provider.js"
# [security.audit.custom_config]
# my_setting = "value"
```

### Multi-Provider Support

For users who want to log to multiple destinations:

```toml
[security.audit]
providers = ["sqlite", "webhook"]

[security.audit.sqlite]
path = "./data/audit.db"

[security.audit.webhook]
url = "https://logs.example.com/ingest"
```

```typescript
// Composite provider that fans out to multiple providers
export class CompositeAuditProvider implements AuditProvider {
  readonly name = 'composite'

  constructor(private providers: AuditProvider[]) {}

  async log(event: AuditEvent): Promise<void> {
    await Promise.allSettled(
      this.providers.map(p => p.log(event))
    )
  }

  // ... other methods
}
```

---

## Consequences

**Positive:**

- Works out of the box with SQLite
- Users can integrate with existing logging infrastructure
- Custom providers enable any integration
- Consistent event schema simplifies analysis
- Buffered writes reduce I/O overhead

**Negative:**

- Plugin loading adds complexity
- Custom providers need documentation
- Multi-provider config is more complex
- Need to handle provider failures gracefully

**Neutral:**

- Built-in providers cover 80% of use cases
- Community can contribute additional providers
- Event schema may need versioning in future

---

## Validation

Success metrics:

- Zero audit events lost in normal operation
- <1ms latency overhead for buffered logging
- Custom provider setup documented with example
- Built-in SQLite handles 1000+ events/sec

---

## References

- [ADR-003: Security-First Design](./003-security-first-design.md)
- [ADR-004: Embedded Salsa & Shardable Gateway](./004-embedded-salsa-shardable-gateway.md)
- [JSON Lines Format](https://jsonlines.org/)
- [Grafana Loki Push API](https://grafana.com/docs/loki/latest/api/#push-log-entries-to-loki)
