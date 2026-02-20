# nachos-admin

Web-based management interface for the Nachos stack. Provides real-time monitoring, configuration editing, session management, and service control via a Hono API backend and Vue 3 SPA.

## Features

- **Status** — gateway health + per-channel connection status
- **Config editor** — live edit `nachos.toml` with tabs for LLM, channels, security (DLP, rate limits, audit), and tools
- **Sessions** — list active sessions, force-expire
- **Audit log** — filterable event trail
- **Skills browser** — scan `SKILL.md` files, show active/denied/disabled status
- **Service control** — restart/stop/start `nachos-*` containers via Docker socket
- **Live logs** — real-time SSE log streaming per service

## Running in Docker

Enable in `nachos.toml`:

```toml
[admin]
enabled = true
port = 8082
```

Set an auth token (recommended):

```bash
# .env
NACHOS_ADMIN_TOKEN=your-secure-token
```

Then `nachos up` — admin UI will be available at `http://localhost:8082`.

## Development

```bash
# Install deps (from workspace root)
pnpm install

# Run backend + frontend dev servers
pnpm --filter @nachos/admin dev

# Type check
pnpm --filter @nachos/admin typecheck

# Production build
pnpm --filter @nachos/admin build
```

Frontend dev server: `http://localhost:5173` (proxies API to backend)
Backend: `http://localhost:8082`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8082` | Server listen port |
| `NACHOS_CONFIG_PATH` | `/app/nachos.toml` | Path to config file |
| `NACHOS_STATE_DIR` | `/app/state` | Directory containing `nachos.db` and `audit.db` |
| `NACHOS_SKILLS_DIR` | `/app/skills` | Directory scanned for `SKILL.md` files |
| `NACHOS_ADMIN_TOKEN` | *(unset)* | Auth token. If unset, API is open (warning printed at startup) |
| `GATEWAY_HEALTH_URL` | `http://gateway:3000/health` | Gateway health endpoint |

## API Reference

Authentication: `Authorization: Bearer <token>` header or `nachos_admin_token` cookie (required when `NACHOS_ADMIN_TOKEN` is set).

### Health
- `GET /api/health` — `{ status, service, timestamp }`

### Status
- `GET /api/status` — gateway health, channel presence, config summary

### Config
- `GET /api/config` — `{ content: string, parsed: object }`
- `PUT /api/config` — `{ content: string }` → full replacement (atomic, `.bak` backup)
- `PATCH /api/config` — `{ path: string, value: unknown }` → update by dot-notation key

### Sessions
- `GET /api/sessions?page&pageSize&status&channel`
- `POST /api/sessions/:id/expire`

### Audit
- `GET /api/audit?page&pageSize&event_type&channel&outcome`
- `GET /api/audit/event-types`

### Skills
- `GET /api/skills`

### Services (requires Docker socket)
- `GET /api/services`
- `POST /api/services/:name/restart`
- `POST /api/services/:name/stop`
- `POST /api/services/:name/start`

### Logs (requires Docker socket)
- `GET /api/logs/:service` — SSE stream. Allowed services: `gateway`, `bus`, `slack`, `discord`, `telegram`, `whatsapp`, `llm-proxy`, `admin`

## Security Notes

- CORS is restricted to `localhost` / `127.0.0.1` — not accessible cross-origin
- Always set `NACHOS_ADMIN_TOKEN` in production
- The Docker socket is mounted `rw` — service control can restart/stop any `nachos-*` container
- Container names are validated before being passed to Docker (`execFile`, not `exec`)
- The `nachos` user (uid 1001) is added to the `docker` group (gid 999 — standard on most Linux hosts)
- Session and audit DBs are mounted read-only; only `nachos.toml` is writable
