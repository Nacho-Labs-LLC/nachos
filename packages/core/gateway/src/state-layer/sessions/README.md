# Sessions Storage Layer

This directory contains the pluggable sessions and messages storage implementations for Nachos.

## Overview

Nachos supports two backends for storing conversation sessions and message history:

- **SQLite** (default): Fast, embedded, single-instance
- **PostgreSQL** (optional): Shared storage for multi-instance deployments

## Architecture

```
SessionsStore Interface
├── StateStorage (SQLite) - packages/core/gateway/src/state.ts
└── PostgresSessionsStore (PostgreSQL) - ./postgres-sessions-store.ts
```

Both implementations provide the same interface defined in `sessions-store-interface.ts`:

- `createSession()` - Create a new conversation session
- `getOrCreateSessionAtomic()` - Atomic get-or-create with race protection
- `getSession()` - Retrieve a session by ID
- `getSessionByConversation()` - Find session by channel + conversation ID
- `updateSession()` - Update session metadata, config, or status
- `deleteSession()` - Delete session and all its messages
- `listSessions()` - Query sessions with filters
- `addMessage()` - Add a message to a session
- `getMessages()` - Retrieve messages for a session
- `getSessionWithMessages()` - Get session + messages in one call
- `getMessageCount()` - Count messages in a session
- `replaceMessages()` - Atomic message replacement (for compaction)

## SQLite Implementation

**File**: `packages/core/gateway/src/state.ts` (StateStorage class)

**Characteristics**:
- Synchronous API (no async/await)
- Single file storage (`./data/gateway.db`)
- WAL mode for better concurrency
- Used by SessionManager (packages/core/gateway/src/session.ts)

**When to use**:
- Development and testing
- Single gateway instance
- Embedded deployments
- <100K messages

## PostgreSQL Implementation

**File**: `./postgres-sessions-store.ts`

**Characteristics**:
- Asynchronous API (async/await)
- Connection pooling via `pg` library
- Supports multiple gateway instances
- ACID transactions with row-level locking

**When to use**:
- Production multi-instance deployments
- Kubernetes/Docker Swarm
- Shared conversation history
- >1M messages

## Configuration

### SQLite (default)

```toml
[runtime.state.sessions]
provider = "sqlite"
db_path = "./data/gateway.db"
```

### PostgreSQL

```toml
[runtime.state.sessions]
provider = "postgres"

[runtime.state.sessions.postgres]
connection_string = "postgres://user:pass@host:5432/nachos"
schema = "public"
max_connections = 10
```

## Database Schema

Both implementations use the same schema:

### Sessions Table

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  system_prompt TEXT,
  config JSONB,              -- TEXT in SQLite
  metadata JSONB,             -- TEXT in SQLite
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(channel, conversation_id)
);
```

### Messages Table

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls JSONB,           -- TEXT in SQLite
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

## Testing

### SQLite Tests

Standard unit tests (always run):

```bash
npm test -- state.test.ts
```

### PostgreSQL Tests

Integration tests (require running Postgres):

```bash
export POSTGRES_TEST_URL="postgres://nachos:nachos@localhost:5432/nachos_test"
npm test -- postgres-sessions-store.test.ts
```

## Migration

### SQLite → PostgreSQL

1. Export SQLite data:
   ```bash
   sqlite3 ./data/gateway.db .dump > sessions.sql
   ```

2. Convert schema (adjust JSONB columns)

3. Import to Postgres:
   ```bash
   psql $CONNECTION_STRING -f sessions_converted.sql
   ```

4. Update config and restart

## Future Work

1. **Async SessionManager**: Refactor SessionManager to async/await to fully support PostgreSQL
2. **Scheduler Migration**: Move scheduler from SQLite to PostgreSQL for shared cron jobs
3. **Migration Tool**: CLI command `nachos migrate sqlite-to-postgres`
4. **Redis Backend**: Consider Redis for ephemeral/cache-first sessions

## Related Documentation

- [ADR-005: Modular Storage Backends](../../docs/architecture/decisions/005-modular-storage-backends.md)
- [State Layer Architecture](../README.md)
- [Session Manager](../../session.ts)
