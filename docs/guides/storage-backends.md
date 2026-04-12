# Storage Backends

Nachos supports two storage backends: **SQLite** (default) and **PostgreSQL**.
Both implement the same state layer interface — choosing between them is an
operational decision, not a code change.

---

## SQLite (default)

SQLite is the default and requires zero infrastructure. State is stored in a
local file on the host.

**When to use SQLite:**

- Single-node deployments (one Gateway instance)
- Local development and personal use
- You want the simplest possible setup
- Persistence is handled by the host filesystem (e.g. Docker volume)

**Config (`nachos.toml`):**

```toml
[state]
provider = "sqlite"
sqlite_path = "./state/nachos.db"   # default; relative to nachos.toml
```

Or via environment variable:

```
NACHOS_STATE_PROVIDER=sqlite
NACHOS_SQLITE_PATH=./state/nachos.db
```

---

## PostgreSQL

PostgreSQL is recommended for production, multi-instance, or team deployments.

**When to use PostgreSQL:**

- Multiple Gateway instances sharing state (horizontal scaling)
- You want a managed database with backup/replication support
- You need stronger concurrent access guarantees
- Memory and session data will grow large and benefit from SQL query
  optimization

**Config (`nachos.toml`):**

```toml
[state]
provider = "postgres"
postgres_url = "postgres://nachos:password@localhost:5432/nachos"
```

Or via environment variable:

```
NACHOS_STATE_PROVIDER=postgres
NACHOS_POSTGRES_URL=postgres://nachos:password@localhost:5432/nachos
```

### Docker Compose example

Add a `postgres` service alongside your Gateway and pass the connection URL:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: nachos
      POSTGRES_USER: nachos
      POSTGRES_PASSWORD: changeme
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U nachos -d nachos']
      interval: 10s
      timeout: 5s
      retries: 5

  gateway:
    image: ghcr.io/nacho-labs-llc/nachos:latest
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      NACHOS_STATE_PROVIDER: postgres
      NACHOS_POSTGRES_URL: postgres://nachos:changeme@postgres:5432/nachos
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    volumes:
      - ./nachos.toml:/app/nachos.toml:ro
      - ./workspace:/workspace
    ports:
      - '3000:3000'

volumes:
  postgres_data:
```

Nachos runs schema migrations automatically on startup — no manual migration
step required.

---

## Migrating from SQLite to PostgreSQL

1. Export your existing state (identity blocks, memory, sessions) using the
   nachos CLI:

   ```bash
   nachos migrate --from ./state --agent-id default
   ```

   See the [Migration Guide](./migration.md) for full details.

2. Update your config or environment to point to the Postgres URL.
3. Restart the Gateway. Nachos will initialize the Postgres schema and you can
   replay any critical state.

---

## CI and Testing

Integration tests against the PostgreSQL state provider run automatically in CI.
The test suite uses `POSTGRES_TEST_URL` to gate these tests — if the env var is
not set, they are skipped (the unit tests with mocked pools still run).

To run the full integration suite locally:

```bash
# Option 1: Docker Compose (matches CI exactly)
pnpm test:docker

# Option 2: Point at an existing Postgres instance
export POSTGRES_TEST_URL="postgres://nachos:nachos@localhost:5432/nachos_test"
export NATS_TEST_URL="nats://localhost:4222"
pnpm test:ci
```
