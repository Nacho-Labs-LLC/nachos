# ADR 005: Modular Storage Backends

**Status:** Accepted **Date:** 2026-02-25 **Updated:** 2026-03-11 (removed
Qdrant — unnecessary for single-user architecture) **Decision Makers:** Nachos
Core Team **Tags:** architecture, storage, scalability, multi-instance

## Context

Nachos currently uses SQLite exclusively for sessions and messages storage,
which works well for single-instance deployments but creates challenges for:

1. **Multi-instance deployments**: Multiple gateway instances cannot share
   conversation history
2. **High availability**: SQLite is file-based and doesn't support distributed
   access
3. **Scalability**: Large deployments need connection pooling and horizontal
   scaling
4. **Cloud-native architectures**: Containerized deployments benefit from
   external databases

Meanwhile, identity, memory, user profiles, and bootstrap data already support
both filesystem and PostgreSQL backends, creating an inconsistent storage
architecture.

## Decision

We will make sessions/messages storage configurable with support for:

- **SQLite** (default): Fast, embedded, zero-config for single-instance
  deployments
- **PostgreSQL** (optional): Shared storage for multi-instance deployments

Semantic search uses local Transformers.js embeddings (via `nachos-embeddings`).
An external vector database (Qdrant) was previously considered but removed —
Nachos is a single-user personal assistant and local embeddings handle the scale
well.

## Architecture

### Storage Layer Structure

```
State Layer
├── Identity (filesystem | postgres) ← already configurable
├── Memory (filesystem | postgres) ← already configurable
├── User Profiles (filesystem | postgres) ← already configurable
├── Bootstrap (filesystem | postgres) ← already configurable
├── Session State (redis | memory) ← already configurable
├── Sessions/Messages (sqlite | postgres) ← NEW
└── Semantic Search (local embeddings)
```

### Configuration Schema

```toml
[runtime.state.sessions]
provider = "sqlite"  # "sqlite" (default) | "postgres"

# SQLite config (default):
db_path = "./data/gateway.db"

# Postgres config (uncomment for multi-instance):
# [runtime.state.sessions.postgres]
# connection_string = "postgres://nachos:nachos@postgres:5432/nachos"
# schema = "public"

[runtime.state.semantic]
provider = "local"

# Local config (default):
model = "Xenova/all-MiniLM-L6-v2"
cache_dir = "./state/embeddings"
```

### Implementation

1. **Config Schema** (`packages/shared/config/src/schema.ts`)
   - Added `SessionsStorageConfig` with sqlite/postgres providers
   - Added `SemanticSearchConfig` with local provider

2. **PostgreSQL Sessions Store**
   (`packages/core/gateway/src/state-layer/sessions/postgres-sessions-store.ts`)
   - Implements same interface as SQLite `StateStorage`
   - Uses `pg` connection pooling
   - Schema matches SQLite (sessions + messages tables)
   - Atomic operations with PostgreSQL transactions

3. **Gateway Integration** (`packages/core/gateway/src/gateway.ts`)
   - Reads `runtime.state.sessions.provider` from config
   - Initializes appropriate storage backend
   - Scheduler continues using SQLite (separate DB when using Postgres sessions)

## When to Use Each Option

### Sessions/Messages Storage

#### Use SQLite when:

- ✅ Single gateway instance
- ✅ Fast local development
- ✅ Simple deployment (no external dependencies)
- ✅ Small to medium conversation history (<100K messages)
- ✅ Embedded/edge deployments

#### Use PostgreSQL when:

- ✅ Multiple gateway instances (load balancing)
- ✅ High availability requirements
- ✅ Shared conversation history across services
- ✅ Cloud-native architecture (Kubernetes, ECS, etc.)
- ✅ Large-scale deployments (>1M messages)
- ✅ Need for advanced querying and analytics

## Performance Implications

### SQLite vs PostgreSQL

| Aspect          | SQLite             | PostgreSQL                  |
| --------------- | ------------------ | --------------------------- |
| **Latency**     | ~0.1ms (in-memory) | ~1-5ms (network)            |
| **Throughput**  | 50K ops/sec        | 10K ops/sec per connection  |
| **Concurrency** | Single writer      | Multiple concurrent writers |
| **Scaling**     | Vertical only      | Horizontal + vertical       |
| **Backup**      | File copy          | pg_dump / WAL archiving     |
| **HA**          | None               | Replication, failover       |

**Recommendation**: Start with SQLite, migrate to Postgres when you need
multi-instance or >100K messages.

## Migration Guide

### SQLite → PostgreSQL

1. **Export SQLite data**:

   ```bash
   sqlite3 ./data/gateway.db .dump > sessions_dump.sql
   ```

2. **Convert schema** (SQLite → PostgreSQL):
   - Replace `TEXT PRIMARY KEY` with `TEXT PRIMARY KEY`
   - Update timestamp handling (`TEXT` → `TIMESTAMP`)
   - Convert JSONB columns

3. **Update config**:

   ```toml
   [runtime.state.sessions]
   provider = "postgres"
   [runtime.state.sessions.postgres]
   connection_string = "postgres://nachos:nachos@postgres:5432/nachos"
   schema = "public"
   ```

4. **Import data**:

   ```bash
   psql $CONNECTION_STRING -f sessions_converted.sql
   ```

5. **Restart gateway**

## Constraints and Limitations

### Current Limitations

1. **Scheduler Database**:
   - Always uses SQLite (even when sessions use Postgres)
   - Cron jobs are not shared across instances
   - Future: Migrate scheduler to support Postgres

2. **SessionManager API**:
   - Currently synchronous (assumes SQLite)
   - Postgres implementation ready but not fully integrated
   - Future: Refactor SessionManager to async/await

### Schema Compatibility

Both SQLite and PostgreSQL implementations maintain schema compatibility:

**Sessions Table**:

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  system_prompt TEXT,
  config JSONB,  -- TEXT in SQLite
  metadata JSONB,  -- TEXT in SQLite
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(channel, conversation_id)
);
```

**Messages Table**:

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls JSONB,  -- TEXT in SQLite
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

## Consequences

### Positive

✅ **Flexibility**: Users choose the right backend for their scale ✅
**Consistency**: Sessions storage follows same pattern as identity/memory ✅
**Scalability**: PostgreSQL enables multi-instance deployments ✅ **No Breaking
Changes**: SQLite remains the default

### Negative

⚠️ **Complexity**: More configuration options to understand ⚠️ **Testing**: Need
to test both SQLite and Postgres paths ⚠️ **Documentation**: Users need guidance
on when to use each option ⚠️ **Migration**: Switching backends requires data
migration

### Risks

- **SessionManager Refactoring**: Current sync API limits Postgres adoption
- **Scheduler Coupling**: Scheduler still depends on SQLite

## Future Work

1. **Async SessionManager** (`HIGH PRIORITY`)
   - Refactor SessionManager to async/await
   - Update all 93 call sites in Gateway
   - Enable full Postgres sessions integration

2. **Unified Scheduler Storage** (`MEDIUM PRIORITY`)
   - Support Postgres for scheduler jobs/runs
   - Share cron jobs across gateway instances

3. **Migration Tooling** (`LOW PRIORITY`)
   - CLI command: `nachos migrate sqlite-to-postgres`
   - Automatic schema conversion
   - Zero-downtime migration support

## References

- [PostgreSQL Connection Pooling Best Practices](https://www.postgresql.org/docs/current/runtime-config-connection.html)
- [SQLite When To Use](https://www.sqlite.org/whentouse.html)
- [Nachos State Layer Architecture](../README.md)

## Related ADRs

- ADR-001: State Layer Design
- ADR-002: Memory Pipeline
- ADR-003: Session Management
- ADR-004: Multi-tenancy

## Approval

**Proposed**: 2026-02-25 **Reviewed**: - **Approved**: - **Implemented**:
Partially (schema + stores complete, Gateway integration pending SessionManager
async refactor)
