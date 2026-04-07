# Next Session Plan: Gap Resolution

> Pick up from `docs/summaries/session-2026-03-03-setup-specs.md`

## Priority 1: Silent Failures & Data Loss Risks

These cause the bot to malfunction with zero feedback. Fix first.

### 1A. SQLite Migration System (~1hr)

**Problem**: `CREATE TABLE IF NOT EXISTS` doesn't add new columns. Schema drift
silently breaks features (we hit this with is_pinned/is_archived). **Fix**: Add
a version table + migration runner to `state.ts` that runs on startup. Check
current schema version, apply pending ALTER TABLEs. Wire into Gateway
constructor. **Files**: `gateway/src/state.ts`, new `gateway/src/migrations/`
entries **Test**: Create DB with old schema, verify migration adds columns and
preserves data.

### 1B. Bootstrap Seeding Logging (~30min)

**Problem**: `state-layer.ts:163-170` catches all errors during bootstrap
seeding and silently returns null. Users get no bootstrap/identity injection
with zero indication of why. **Fix**: Add `logger.warn()` in the catch block
with the error details. Also `mkdir -p` the directory if it doesn't exist before
writing. **Files**: `shared/state/src/state-layer.ts` **Test**: Mock filesystem
error, verify warning logged and error includes path.

### 1C. Config Path Validation (~30min)

**Problem**: Relative paths like `./state/bootstrap` pass config validation but
fail at runtime in Docker because WORKDIR is wrong. **Fix**: Add a validation
warning when filesystem provider paths are relative. Suggest absolute paths in
Docker environments. Check via `process.env.NACHOS_CONTAINER` or similar.
**Files**: `shared/config/src/validation.ts` **Test**: Validate config with
relative path → warning emitted. Absolute path → no warning.

## Priority 2: Code Bugs

### 2A. setTerminal Timing Fix (~30min)

**Problem**: In `status-reactions.ts`, `finished = true` is set before
`applyEmoji()` runs. The enqueued work checks `finished` and exits early, so
terminal emojis (checkmark/X) never apply via the standard path. **Fix**: Move
`finished = true` to after `applyEmoji` completes, or add an `isTerminal`
parameter to `applyEmoji` that bypasses the `finished` check. **Files**:
`discord/src/status-reactions.ts` **Test**: Already covered by SR-07/SR-08 tests
— they'll validate the fix.

### 2B. Discord Inbound Attachments (~1hr)

**Problem**: `handleMessage()` only extracts `message.content` (text). Discord
file attachments (`message.attachments`) are silently dropped. **Fix**: Map
Discord attachments to `ChannelInboundMessage.content.attachments[]` with
type/url/name. Download attachment data and convert to base64 or pass URL.
**Files**: `discord/src/index.ts` handleMessage, `@nachos/types` attachment
schema **Test**: Mock Discord message with attachment, verify inbound payload
includes it.

## Priority 3: Feature Gaps

### 3A. Typing During Tool Execution (~30min)

**Problem**: Typing indicator only fires on 'thinking' status. During tool
execution (which can take 30s+), typing stops. **Fix**: In the Discord adapter's
status event handler, also trigger typing on 'tool' status events, not just
'thinking'. **Files**: `discord/src/index.ts` handleStatusEvent **Test**: Expand
TI tests — verify typing refreshed on tool status event.

### 3B. Env-to-Config Bridge for Channels (~1hr)

**Problem**: `CHANNEL_DISCORD_GUILD_ID`, `CHANNEL_DISCORD_USER_ALLOWLIST`, etc.
are set in compose but never read. All config must be in nachos.toml. **Fix**:
In `discord/src/main.ts`, after loading config, merge env vars into
channelConfig if the TOML sections are missing. Env vars are the fallback, TOML
takes precedence. **Files**: `discord/src/main.ts` **Test**: Start adapter with
env vars only (no TOML servers section), verify server config populated.

### 3C. Streaming Integration with Discord (~2hr)

**Problem**: `StreamingSessionManager` exists but Discord doesn't consume stream
chunks. All responses arrive as single messages after full completion. **Fix**:
Subscribe Discord adapter to `nachos.llm.stream.*` topic. On chunks, edit the
Discord message progressively (using `message.edit()`). Throttle edits to avoid
rate limits. **Files**: `discord/src/index.ts`, possibly new
`discord/src/streaming.ts` **Test**: Mock stream chunks, verify message edits
happen at throttled intervals.

## Priority 4: Test Coverage Gaps

### 4A. LLM→Tool→LLM End-to-End Test (~2hr)

**Problem**: No test covers the full cycle where LLM returns tool calls, gateway
executes them, sends results back to LLM, gets final text response. **Fix**:
Create `gateway/src/llm-tool-loop.test.ts` with mocked bus. Mock LLM proxy to
return tool_calls on first request, text on second. Verify full message chain
stored in session. **Files**: New `gateway/src/llm-tool-loop.test.ts`

### 4B. Memory Pipeline Integration Test (~1.5hr)

**Problem**: Memory extraction during context compaction is untested. If it
silently fails, the bot loses long-term memory. **Fix**: Create integration test
that fills a session past the soft threshold, triggers compaction, verifies
memory entries written to store. **Files**: New test in `gateway/src/` or
`shared/context-manager/`

### 4C. Remaining Spec Gaps (~2hr)

Cover the ~40 remaining untested behaviors from the spec docs:

- Redis rate limiter store
- Subagent bootstrap filtering
- Discord slash command edge cases (DM context, error responses)
- Audit HMAC signature verification

## Execution Order

```
Session start: pick up from docs/summaries/session-2026-03-03-setup-specs.md

Phase 1 (parallel):
  Track A: 1A (migration system) + 1B (bootstrap logging) + 1C (path validation)
  Track B: 2A (setTerminal fix) + 2B (inbound attachments)

Phase 2 (parallel):
  Track A: 3A (typing during tools) + 3B (env-to-config bridge)
  Track B: 4A (LLM tool loop test) + 4B (memory pipeline test)

Phase 3:
  3C (streaming integration — depends on understanding from 4A)
  4C (remaining spec gaps)

Phase 4:
  Full regression: pnpm typecheck && pnpm lint && pnpm test
  Update spec docs: mark newly-tested behaviors as YES
  Docker rebuild and live test with Discord bot
```

## Estimated Effort

| Phase     | Items                                                                   | Est. Time   |
| --------- | ----------------------------------------------------------------------- | ----------- |
| Phase 1   | Migration, bootstrap logging, path validation, setTerminal, attachments | ~3.5hr      |
| Phase 2   | Typing, env bridge, LLM loop test, memory test                          | ~5hr        |
| Phase 3   | Streaming, remaining spec gaps                                          | ~4hr        |
| Phase 4   | Verification, docs update, rebuild                                      | ~1hr        |
| **Total** |                                                                         | **~13.5hr** |
