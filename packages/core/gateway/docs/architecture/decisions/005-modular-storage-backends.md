# ADR 005: Modular Storage Backends

**Status:** Accepted  
**Date:** 2026-02-25  
**Decision Makers:** Nachos Core Team  
**Tags:** architecture, storage, scalability, multi-instance

## Context

Nachos currently uses SQLite exclusively for sessions and messages storage, which works well for single-instance deployments but creates challenges for:

1. **Multi-instance deployments**: Multiple gateway instances cannot share conversation history
2. **High availability**: SQLite is file-based and doesn't support distributed access
3. **Scalability**: Large deployments need connection pooling and horizontal scaling
4. **Cloud-native architectures**: Containerized deployments benefit from external databases

Meanwhile, identity, memory, user profiles, and bootstrap data already support both filesystem and PostgreSQL backends, creating an inconsistent storage architecture.

## Decision

We will make sessions/messages storage configurable with support for:

- **SQLite** (default): Fast, embedded, zero-config for single-instance deployments
- **PostgreSQL** (optional): Shared storage for multi-instance deployments

Additionally, we will add support for semantic search backends:

- **Local** (default): Filesystem + Transformers.js embeddings
- **Qdrant** (optional): Vector database for production semantic search

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
└── Semantic Search (local | qdrant) ← NEW
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
provider = "local"  # "local" (default) | "qdrant"

# Local config (default):
model = "Xenova/all-MiniLM-L6-v2"
cache_dir = "./state/embeddings"

# Qdrant config (uncomment for production):
# [runtime.state.semantic.qdrant]
# url = "http://qdrant:6333"
# collection = "nachos-memory"
# api_key = "${QDRANT_API_KEY}"  # optional
```

### Implementation

1. **Config Schema** (`packages/shared/config/src/schema.ts`)
   - Added `SessionsStorageConfig` with sqlite/postgres providers
   - Added `SemanticSearchConfig` with local/qdrant providers

2. **PostgreSQL Sessions Store** (`packages/core/gateway/src/state-layer/sessions/postgres-sessions-store.ts`)
   - Implements same interface as SQLite `StateStorage`
   - Uses `pg` connection pooling
   - Schema matches SQLite (sessions + messages tables)
   - Atomic operations with PostgreSQL transactions

3. **Qdrant Memory Store** (`packages/core/gateway/src/state-layer/memory/qdrant-memory-store.ts`)
   - Implements `MemoryStore` interface
   - HTTP-based Qdrant client
   - Vector + metadata hybrid search
   - Automatic collection initialization

4. **Gateway Integration** (`packages/core/gateway/src/gateway.ts`)
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

### Semantic Search

#### Use Local (Transformers.js) when:
- ✅ Development and testing
- ✅ Single-instance deployments
- ✅ Privacy-sensitive environments (no external services)
- ✅ Small memory datasets (<10K entries)
- ✅ Offline/air-gapped deployments

#### Use Qdrant when:
- ✅ Production deployments
- ✅ Large memory datasets (>100K entries)
- ✅ Advanced vector search features
- ✅ Multi-tenancy with isolation
- ✅ High-performance semantic search requirements
- ✅ Hybrid vector + metadata filtering

## Performance Implications

### SQLite vs PostgreSQL

| Aspect | SQLite | PostgreSQL |
|--------|--------|------------|
| **Latency** | ~0.1ms (in-memory) | ~1-5ms (network) |
| **Throughput** | 50K ops/sec | 10K ops/sec per connection |
| **Concurrency** | Single writer | Multiple concurrent writers |
| **Scaling** | Vertical only | Horizontal + vertical |
| **Backup** | File copy | pg_dump / WAL archiving |
| **HA** | None | Replication, failover |

**Recommendation**: Start with SQLite, migrate to Postgres when you need multi-instance or >100K messages.

### Local vs Qdrant

| Aspect | Local (Transformers.js) | Qdrant |
|--------|------------------------|--------|
| **Embedding Generation** | ~50-200ms (CPU) | External service required |
| **Search Latency** | ~10-100ms | ~1-10ms |
| **Memory Usage** | Model in RAM (~100MB) | Separate service |
| **Scalability** | Limited by node resources | Horizontal scaling |
| **Features** | Basic vector search | Advanced filters, HNSW, quantization |

**Recommendation**: Use local for development, Qdrant for production with >10K memory entries.

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

### Local → Qdrant

1. **Deploy Qdrant**:
   ```yaml
   # docker-compose.yml
   qdrant:
     image: qdrant/qdrant:latest
     ports:
       - "6333:6333"
     volumes:
       - qdrant-data:/qdrant/storage
   ```

2. **Update config**:
   ```toml
   [runtime.state.semantic]
   provider = "qdrant"
   [runtime.state.semantic.qdrant]
   url = "http://qdrant:6333"
   collection = "nachos-memory"
   ```

3. **Re-index existing memory** (automatic on first query)

4. **Restart gateway**

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

3. **Embedding Generation**:
   - Qdrant store requires external embedding service
   - Placeholder implementation returns zero vectors
   - Future: Integrate with OpenAI, Cohere, or local models

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

✅ **Flexibility**: Users choose the right backend for their scale  
✅ **Consistency**: Sessions storage follows same pattern as identity/memory  
✅ **Scalability**: PostgreSQL enables multi-instance deployments  
✅ **Performance**: Qdrant provides production-grade semantic search  
✅ **No Breaking Changes**: SQLite remains the default  

### Negative

⚠️ **Complexity**: More configuration options to understand  
⚠️ **Testing**: Need to test both SQLite and Postgres paths  
⚠️ **Documentation**: Users need guidance on when to use each option  
⚠️ **Migration**: Switching backends requires data migration  

### Risks

- **SessionManager Refactoring**: Current sync API limits Postgres adoption
- **Embedding Service**: Qdrant requires external embedding generation
- **Scheduler Coupling**: Scheduler still depends on SQLite

## Future Work

1. **Async SessionManager** (`HIGH PRIORITY`)
   - Refactor SessionManager to async/await
   - Update all 93 call sites in Gateway
   - Enable full Postgres sessions integration

2. **Unified Scheduler Storage** (`MEDIUM PRIORITY`)
   - Support Postgres for scheduler jobs/runs
   - Share cron jobs across gateway instances

3. **Embedding Service Integration** (`MEDIUM PRIORITY`)
   - OpenAI embeddings connector
   - Cohere embeddings connector
   - Local embedding server (Ollama, vLLM)

4. **Migration Tooling** (`LOW PRIORITY`)
   - CLI command: `nachos migrate sqlite-to-postgres`
   - Automatic schema conversion
   - Zero-downtime migration support

5. **Additional Backends** (`FUTURE`)
   - MySQL/MariaDB for sessions
   - MongoDB for semi-structured data
   - Redis for ephemeral sessions
   - Weaviate/Pinecone for semantic search

## References

- [PostgreSQL Connection Pooling Best Practices](https://www.postgresql.org/docs/current/runtime-config-connection.html)
- [Qdrant Documentation](https://qdrant.tech/documentation/)
- [SQLite When To Use](https://www.sqlite.org/whentouse.html)
- [Nachos State Layer Architecture](../README.md)

## Related ADRs

- ADR-001: State Layer Design
- ADR-002: Memory Pipeline
- ADR-003: Session Management
- ADR-004: Multi-tenancy

## Approval

**Proposed**: 2026-02-25  
**Reviewed**: -  
**Approved**: -  
**Implemented**: Partially (schema + stores complete, Gateway integration pending SessionManager async refactor)
