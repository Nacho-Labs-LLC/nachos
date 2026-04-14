# Plan: OpenClaw → Nachos Migration Tool

**Branch**: `feat/194-bootstrap-prompt-config`  
**Status**: Pre-implementation — ready for review and discussion  
**Last updated**: 2026-04-13

---

## Goal

Reduce friction for OpenClaw users switching to Nachos by providing a two-path migration
system:

- **Fast path**: A CLI command (`nachos migrate openclaw`) that statically translates
  `openclaw.json` → `nachos.toml` + `.env` before Nachos is even running
- **Guided path**: An LLM-assisted bootstrap conversation on first boot that picks up
  unresolved gaps left by the static importer

The two paths are sequential, not alternative. Fast path first, guided path for the hard
cases.

---

## Source Material

### OpenClaw config
- **Location**: `~/.openclaw/openclaw.json` (JSON5 format)
- **Type definitions**: `openclaw/src/config/types.openclaw.ts`
- **Key sections**: `agents`, `auth`, `channels`, `models`, `skills`, `tools`, `ui`

### Nachos config
- **Location**: `nachos.toml` (TOML format)
- **Schema**: `packages/shared/config/src/schema.ts`
- **Env vars**: `.env`

---

## Field Mapping Reference

| OpenClaw field | Nachos equivalent | Notes |
|---|---|---|
| `agents.list[0].identity.name` | `assistant.name` | Direct |
| `agents.list[0].identity.theme` | `[SOUL]` bootstrap block | Free text → block content |
| `agents.list[0].identity.emoji` | `[IDENTITY]` bootstrap block field | |
| `agents.list[0].identity.avatar` | `[IDENTITY]` bootstrap block field | |
| `ui.seamColor` | No equivalent | Flag as unsupported |
| `models.providers.*` + `agents.defaults.model.primary` | `llm.provider` + `llm.model` | Needs provider normalisation |
| `auth.profiles.*` (api_key entries) | `llm.profiles[].api_key_env` + `.env` key | Nachos refs env var names, doesn't store raw keys |
| `auth.cooldowns` | `llm.cooldowns` | Field names differ slightly |
| `channels.discord` | `channels.discord` | Field names differ (camelCase → snake_case) |
| `channels.slack` | `channels.slack` | Same |
| `channels.telegram` | `channels.telegram` | Same |
| `channels.whatsapp` | `channels.whatsapp` | Same |
| `channels.irc` | ❌ No equivalent | Flag: unsupported |
| `channels.signal` | ❌ No equivalent | Flag: unsupported |
| `channels.imessage` | ❌ No equivalent | Flag: unsupported |
| `channels.msteams` | ❌ No equivalent | Flag: unsupported |
| `channels.googlechat` | ❌ No equivalent | Flag: unsupported |
| `skills.allowBundled` + `skills.entries` | `tools.*` (partial) | Skills ≠ tools — approximation only |
| `tools.allow/deny` | `security` allow/deny lists | Partial overlap |
| `session.*` | No direct equivalent | History import is optional/separate |

---

## Architecture

### New package: `packages/cli/src/commands/migrate/`

```
packages/cli/src/commands/migrate/
├── index.ts                  # Command entry point — registers `nachos migrate openclaw`
├── openclaw-reader.ts        # Reads + parses openclaw.json (JSON5)
├── openclaw-mapper.ts        # Maps OpenClaw fields → NachosConfig shape
├── toml-writer.ts            # Serialises NachosConfig to nachos.toml string
├── env-writer.ts             # Generates .env content from mapped credentials
├── report.ts                 # Builds migration-report.md (mapped / flagged / skipped)
└── migrate.test.ts           # Unit tests for mapper + report
```

### Modified files

| File | Change |
|---|---|
| `packages/cli/src/cli.ts` | Register `migrate` command |
| `packages/shared/config/src/schema.ts` | Add optional `openclaw_config_path?: string` to `RuntimeConfig` |
| `packages/shared/state/src/bootstrap/bootstrap-templates.ts` | Add `createOpenClawBootstrapBlocks()` — pre-filled blocks from OpenClaw identity |
| `packages/core/gateway/src/main.ts` | Detect `OPENCLAW_CONFIG_PATH` env var and pass to bootstrap prompt assembly |
| `.env.example` | Add commented `OPENCLAW_CONFIG_PATH` entry |

---

## Phase 1: Static CLI Importer (Fast Path)

### Command interface

```bash
nachos migrate openclaw                        # Auto-detect ~/.openclaw/openclaw.json
nachos migrate openclaw /path/to/openclaw.json # Explicit path
nachos migrate openclaw --dry-run              # Print output, write nothing
nachos migrate openclaw --out ./my-nachos/     # Write to custom directory
```

### What it produces

```
./nachos.toml             # Generated config (merges into existing if present)
./.env                    # Credential env vars (appended, not overwritten)
./migration-report.md     # Full report: mapped / approximated / unsupported / manual
```

### Mapping logic (in `openclaw-mapper.ts`)

Three categories of fields:

**1. Confident mappings** — translate directly, no user input needed:
- LLM provider/model (if using Anthropic, OpenAI, Gemini — known providers)
- Channel tokens (Discord bot token, Slack tokens, Telegram token, etc.)
- `assistant.name` from agent identity
- `security.mode` approximation from `tools.profile`
- `llm.cooldowns` from `auth.cooldowns`

**2. Approximations** — best-effort translation, flagged in report for review:
- `skills.allowBundled` → `tools` section (commented suggestions, not live config)
- `agents.defaults.model` fallback chain → `llm.fallback_order`
- `channels.defaults.groupPolicy` → per-channel `dm_policy`
- `agents.list[0].identity.theme` → `[SOUL]` bootstrap block (verbatim)

**3. Unsupported** — written as comments in the report, not in the config:
- IRC, Signal, iMessage, MS Teams, Google Chat channels
- `audio` / `talk` (voice features)
- `cron` jobs
- `plugins` (no direct equivalent)
- `ui.seamColor`
- Raw OAuth credentials (Nachos uses env vars only, not stored tokens)

### Credential handling

OpenClaw's `auth-profiles.json` stores raw keys. Nachos stores env var names.

The importer:
1. Reads the key value from `auth-profiles.json`
2. Derives an env var name (e.g., `ANTHROPIC_API_KEY_PROFILE_1`)
3. Writes `api_key_env = "ANTHROPIC_API_KEY_PROFILE_1"` into `nachos.toml`
4. Writes `ANTHROPIC_API_KEY_PROFILE_1=sk-ant-...` into `.env`
5. Flags in the report: "Credentials written to .env — review before committing"

**Never writes raw keys into nachos.toml.**

### Report format (`migration-report.md`)

```markdown
# OpenClaw → Nachos Migration Report
Generated: 2026-04-13T12:00:00Z
Source: ~/.openclaw/openclaw.json

## ✅ Mapped (14 fields)
- LLM provider: anthropic → llm.provider = "anthropic"
- Model: claude-opus-4-1 → llm.model = "claude-opus-4-1"
- Discord bot token → DISCORD_BOT_TOKEN in .env
- ...

## ⚠ Approximated — review recommended (3 fields)
- agents.defaults.model.fallbacks → llm.fallback_order (verify model IDs are correct)
- skills.allowBundled → see [tools] comments in nachos.toml
- channels.defaults.groupPolicy → applied to each channel individually

## ❌ Unsupported — manual action required (4 features)
- channels.irc — IRC is not supported in Nachos
- channels.signal — Signal is not supported in Nachos
- audio/talk — Voice features not available in Nachos
- plugins.acpx — No Nachos equivalent

## 🔑 Credentials written to .env
WARNING: Review .env before committing. Never commit API keys to git.
- ANTHROPIC_API_KEY (from auth-profiles.json)
- DISCORD_BOT_TOKEN (from channels.discord.token)

## Next steps
3 items could not be resolved automatically.
Run `nachos up` — your assistant will walk you through them on first boot.
Set in .env: OPENCLAW_CONFIG_PATH=~/.openclaw/openclaw.json
```

---

## Phase 2: LLM-Assisted Bootstrap (Guided Path)

Only triggers if `OPENCLAW_CONFIG_PATH` is set in `.env` AND unresolved items exist in the
migration report (tracked via a `migrationPending: string[]` field written to the bootstrap
store by the CLI importer).

### How it hooks in

1. CLI importer writes a partial `BootstrapProfile` to the bootstrap store with:
   - Pre-filled `[IDENTITY]`, `[SOUL]`, `[AGENTS]` blocks from OpenClaw identity
   - `[BOOTSTRAP]` block replaced with the OpenClaw migration prompt (see below)
   - `migrationPending` list of unresolved field keys

2. Gateway's `main.ts` detects `OPENCLAW_CONFIG_PATH` and passes it to the bootstrap
   prompt assembler

3. On first conversation, the `[BOOTSTRAP]` block instructs the LLM to:
   - Read the OpenClaw config via a tool call (read-only filesystem access)
   - Address each item in `migrationPending` one by one
   - Write resolved values to `nachos.toml` and `.env` via tool calls
   - Call `bootstrap(action: set, identityCompleted: true)` when done

### OpenClaw migration bootstrap prompt template

```
[BOOTSTRAP]
You are helping {{name}} migrate from OpenClaw to Nachos.

The automatic importer ran successfully but needs your help with {{count}} items
it couldn't resolve. Their OpenClaw config is at: {{openclaw_config_path}}

Use the read_file tool to inspect their config, then work through these items:
{{#each migrationPending}}
- {{this}}
{{/each}}

For each item: explain the OpenClaw feature, what the Nachos equivalent is (or that
there isn't one), and what you recommend. If a config change is needed, make it.

When all items are resolved, call bootstrap(action: set, identityCompleted: true).
```

---

## Open Questions (Discuss Before Implementing)

1. **Session history import**: Should sessions/transcripts be imported at all? OpenClaw
   stores conversation history in `~/.openclaw/agent-*/sessions/`. Nachos uses a different
   format. Options: skip entirely, import as read-only archive, or full import.

2. **Merge vs overwrite**: If a `nachos.toml` already exists, should the importer merge
   into it or refuse to overwrite? Merging is safer but more complex.

3. **Multi-agent configs**: OpenClaw supports multiple agents (`agents.list[]`). Nachos is
   single-assistant. Should the importer pick the `default: true` agent only, or prompt the
   user to choose?

4. **Plugin handling**: OpenClaw has a rich plugin system with no Nachos equivalent. Should
   the LLM bootstrap phase try to find Nachos skill equivalents, or just document the gap?

5. **Scope of guided path**: Should the LLM bootstrap be able to write to `nachos.toml`
   directly (via tool call), or only give instructions for the user to apply manually?
   Writing directly is smoother but riskier.

6. **`nachos.toml` already configured**: If the user runs the importer after already
   having set up Nachos partially, what wins — their manual config or the OpenClaw import?

---

## Sequencing

```
Phase 1 (Static importer — no LLM required)
  1. openclaw-reader.ts       — JSON5 parser + type definitions
  2. openclaw-mapper.ts       — field mapping logic
  3. toml-writer.ts           — nachos.toml serialiser
  4. env-writer.ts            — .env generator
  5. report.ts                — migration-report.md builder
  6. index.ts                 — CLI command wiring
  7. migrate.test.ts          — unit tests for mapper + writer

Phase 2 (Bootstrap integration)
  8. bootstrap-templates.ts   — add createOpenClawBootstrapBlocks()
  9. schema.ts                — add migrationPending to bootstrap store type
  10. main.ts                 — detect OPENCLAW_CONFIG_PATH, pass to assembler
  11. Migration bootstrap prompt template
```

Phase 1 is fully independent and shippable on its own. Phase 2 builds on it.

---

## References

- OpenClaw types: `C:\dev\nachos-workspace\openclaw\src\config\types.openclaw.ts`
- Nachos config schema: `packages/shared/config/src/schema.ts`
- Bootstrap templates: `packages/shared/state/src/bootstrap/bootstrap-templates.ts`
- Bootstrap store types: `packages/shared/types/src/state-types.ts`
- Gateway bootstrap wiring: `packages/core/gateway/src/main.ts`
- Existing migrate command (partial): none — greenfield
