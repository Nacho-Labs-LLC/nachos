# Quick Start: Testing Postgres Sessions Store

This guide shows how to test the PostgreSQL sessions store implementation.

## Prerequisites

- Docker (for running Postgres)
- Node.js 18+ (for running tests)
- pnpm (Nachos uses pnpm workspaces)

## Step 1: Start PostgreSQL

Using Docker:

```bash
docker run -d \
  --name nachos-postgres-test \
  -e POSTGRES_USER=nachos \
  -e POSTGRES_PASSWORD=nachos \
  -e POSTGRES_DB=nachos_test \
  -p 5432:5432 \
  postgres:15-alpine
```

Or using Docker Compose:

```yaml
# docker-compose.test.yml
version: '3.8'
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: nachos
      POSTGRES_PASSWORD: nachos
      POSTGRES_DB: nachos_test
    ports:
      - "5432:5432"
    volumes:
      - postgres-test-data:/var/lib/postgresql/data

volumes:
  postgres-test-data:
```

```bash
docker-compose -f docker-compose.test.yml up -d
```

## Step 2: Set Environment Variable

```bash
export POSTGRES_TEST_URL="postgres://nachos:nachos@localhost:5432/nachos_test"
```

## Step 3: Run Tests

From the Nachos root directory:

```bash
pnpm test -- postgres-sessions-store.test.ts
```

Or from the gateway package:

```bash
cd packages/core/gateway
pnpm test -- postgres-sessions-store.test.ts
```

## Step 4: Verify Results

You should see output like:

```
✓ packages/core/gateway/src/state-layer/sessions/postgres-sessions-store.test.ts (11)
  ✓ PostgresSessionsStore (11)
    ✓ should create and retrieve a session
    ✓ should get or create session atomically
    ✓ should handle concurrent get or create
    ✓ should add and retrieve messages
    ✓ should get session with messages
    ✓ should update session
    ✓ should delete session and messages
    ✓ should list sessions with filtering
    ✓ should get message count
    ✓ should replace messages
    ✓ should handle JSONB config and metadata

Test Files  1 passed (1)
     Tests  11 passed (11)
```

## Step 5: Inspect Database

Connect to Postgres:

```bash
docker exec -it nachos-postgres-test psql -U nachos -d nachos_test
```

Check created tables:

```sql
\dt nachos_test.*

-- Should show:
-- nachos_test.sessions
-- nachos_test.messages
```

View schema:

```sql
\d nachos_test.sessions
\d nachos_test.messages
```

Query data:

```sql
SELECT * FROM nachos_test.sessions;
SELECT * FROM nachos_test.messages;
```

## Step 6: Cleanup

Stop and remove the test database:

```bash
docker stop nachos-postgres-test
docker rm nachos-postgres-test
```

Or with Docker Compose:

```bash
docker-compose -f docker-compose.test.yml down -v
```

## Manual Testing

You can also test the store interactively:

```typescript
import { Pool } from 'pg';
import { PostgresSessionsStore } from './postgres-sessions-store.js';

const pool = new Pool({
  connectionString: 'postgres://nachos:nachos@localhost:5432/nachos_test',
  max: 5,
});

const store = new PostgresSessionsStore(pool, 'public');

// Create a session
const session = await store.createSession({
  channel: 'discord',
  conversationId: 'test-123',
  userId: 'user-456',
  systemPrompt: 'You are a helpful assistant',
});

console.log('Created session:', session);

// Add a message
const message = await store.addMessage({
  sessionId: session.id,
  role: 'user',
  content: 'Hello, world!',
});

console.log('Added message:', message);

// Get session with messages
const withMessages = await store.getSessionWithMessages(session.id);
console.log('Session with messages:', withMessages);

// Cleanup
await pool.end();
```

## Troubleshooting

### Connection Refused

If you see `ECONNREFUSED`, ensure Postgres is running:

```bash
docker ps | grep postgres
```

### Authentication Failed

Check your connection string matches the Docker environment variables:

```bash
docker exec nachos-postgres-test env | grep POSTGRES
```

### Schema Not Found

The test creates a `nachos_test` schema automatically. If you see schema errors, ensure the test setup runs:

```typescript
await pool.query(`CREATE SCHEMA IF NOT EXISTS "nachos_test"`);
```

### Tests Skipped

If tests don't run, ensure `POSTGRES_TEST_URL` is set:

```bash
echo $POSTGRES_TEST_URL
# Should output: postgres://nachos:nachos@localhost:5432/nachos_test
```

## Performance Benchmarking

Compare SQLite vs Postgres performance:

```bash
# Run SQLite tests
pnpm test -- state.test.ts

# Run Postgres tests
export POSTGRES_TEST_URL="postgres://nachos:nachos@localhost:5432/nachos_test"
pnpm test -- postgres-sessions-store.test.ts
```

Expected results:
- SQLite: ~0.1ms per operation (in-memory)
- Postgres: ~1-5ms per operation (network overhead)

## Next Steps

- See [README.md](./README.md) for architecture overview
- See [ADR-005](../../docs/architecture/decisions/005-modular-storage-backends.md) for decision context
- See [MODULAR_STORAGE_IMPLEMENTATION.md](../../../../../MODULAR_STORAGE_IMPLEMENTATION.md) for implementation status

## Production Configuration

Once testing is complete, configure production Postgres:

```toml
# nachos.toml
[runtime.state.sessions]
provider = "postgres"

[runtime.state.sessions.postgres]
connection_string = "postgres://nachos:${DB_PASSWORD}@postgres.example.com:5432/nachos_prod"
schema = "public"
max_connections = 20
ssl = true
```

Then restart the gateway:

```bash
nachos restart gateway
```

**Note**: Full Gateway integration is pending SessionManager async refactor. This quick start demonstrates the Postgres store works standalone.
