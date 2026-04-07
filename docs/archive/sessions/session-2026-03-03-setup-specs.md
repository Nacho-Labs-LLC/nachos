# Session Summary: Stack Setup, Specs & Regression Testing (2026-03-03)

## What Was Done

### Stack Brought Online

- Generated NATS_TOKEN and REDIS_PASSWORD, configured .env
- Fixed gateway config validation (rebuilt image for `profile_order` support)
- Fixed SQLite db_path resolution (relative → absolute `/app/data/gateway.db`)
- Fixed Redis URL (localhost → Docker service name, added env var fallback in
  main.ts)
- Fixed Discord channel config (added `[[channels.discord.servers]]` to
  nachos.toml)
- Fixed ANTHROPIC_SETUP_TOKEN forwarding to LLM proxy container
- Migrated SQLite schema (added is_pinned, is_archived, last_activity columns)
- Added nachos.toml volume mounts to gateway and channel-defaults
- Added state directory volume mount (`./state:/app/state`)
- Enabled typing_indicators and status_emojis in Discord config
- Converted all relative state paths to absolute Docker paths
- All 11 services running and healthy

### Specs Created

- `docs/specs/gateway-pipeline.md` — 12 features, 156 behaviors
- `docs/specs/discord-adapter.md` — 8 features, 106 behaviors
- `docs/specs/config-and-infrastructure.md` — 3 features, 30 behaviors

### Tests Written (88 new, 1056 → 1144 total)

- `tools/approval-manager.test.ts` (17 tests) — NEW
- `streaming/streaming-session-manager.test.ts` (10 tests) — NEW
- `tools/tool-executor.test.ts` (12 tests) — NEW
- `discord/src/status-reactions.test.ts` (14 tests) — NEW
- `security/rate-limiter.test.ts` (+8 tests) — EXPANDED
- `gateway/src/gateway.test.ts` (+14 tests) — EXPANDED
- `discord/src/index.test.ts` (+13 tests) — EXPANDED

### Code Fixes

- Admin frontend: Message.timestamp → Message.createdAt (4 locations)
- SessionDropdown.vue: added missing onUnmounted import
- ChatPage.vue: status.error ?? null type narrowing
- gateway/src/main.ts: added process.env.REDIS_URL fallback for state layer
- docker-compose.dev.yml: added setup token forwarding, nachos.toml mounts,
  state volume
- Prettier auto-fixed 6 formatting errors

## Files Modified

- `nachos-core/.env` — added NATS_TOKEN, REDIS_PASSWORD
- `nachos-core/nachos.toml` — absolute paths, Discord servers, status_emojis,
  typing_indicators
- `nachos-core/docker-compose.dev.yml` — volume mounts, ANTHROPIC_SETUP_TOKEN
- `nachos-core/packages/core/gateway/src/main.ts` — REDIS_URL env fallback
- `nachos-core/packages/core/admin/frontend/src/api/webchat.ts` — createdAt fix
- `nachos-core/packages/core/admin/frontend/src/components/SessionDropdown.vue`
  — onUnmounted
- `nachos-core/packages/core/admin/frontend/src/pages/ChatPage.vue` —
  createdAt + type fix

## Open Issues for Next Session

### Infrastructure (4 items)

1. **No SQLite migration system** — schema drift breaks existing DBs silently
2. **No env-to-config bridge for channels** — CHANNEL*DISCORD*\* env vars are
   never read
3. **Config validation doesn't check Docker paths** — relative paths pass
   validation, fail at runtime
4. **Bootstrap seeding fails silently** — no logging when bootstrap profile
   creation fails

### Code Bugs (2 items)

5. **setTerminal timing in status-reactions.ts** — `finished=true` set before
   `applyEmoji`, fragile logic
6. **Discord inbound attachments dropped** — handleMessage only extracts text,
   files never forwarded

### Missing Features (3 items)

7. **No typing during tool execution** — only fires on 'thinking', stops during
   long tool runs
8. **Streaming not wired to Discord** — responses arrive as single message, not
   progressive
9. **Context memory extraction untested** — memory pipeline has no integration
   test

### Test Coverage Gaps (~90 untested behaviors)

10. Full LLM→tool→LLM cycle end-to-end test
11. Redis store integration for rate limiter
12. Subagent bootstrap filtering
13. Memory vector retrieval integration
14. Discord slash command edge cases
15. Audit HMAC signature verification
16. Memory pipeline extraction integration
