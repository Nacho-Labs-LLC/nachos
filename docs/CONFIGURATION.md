# Nachos Configuration Reference

Complete reference for `nachos.toml` — the single configuration file for the
entire Nachos stack.

**Source of truth**: TypeScript types in `packages/shared/config/src/schema.ts`,
validated by `packages/shared/config/src/validation.ts`.

---

## File Location

Nachos looks for `nachos.toml` in this order:

1. Current working directory (`./nachos.toml`)
2. Home directory (`~/.nachos/nachos.toml`)
3. Custom path via `loadConfig(path)` or `loadAndValidateConfig({ configPath })`

Secrets (API keys, bot tokens) belong in `.env`, not in `nachos.toml`.

---

## Validation

Configuration is validated at startup. Validation checks:

- **Unknown keys** — typos or removed keys cause errors
- **Required fields** — missing sections or empty values
- **Value constraints** — ranges, valid enum values, URL formats
- **Cross-field rules** — e.g., `shell` tool requires permissive mode

Run validation programmatically:

```ts
import { loadAndValidateConfig } from '@nachos/config';

const config = loadAndValidateConfig(); // throws on error
```

---

## TOML Ordering Rules

TOML array tables (`[[section]]`) capture all subsequent keys until the next
section header. Place scalar keys **before** array table entries:

```toml
# CORRECT — profile_order at [llm] level
[llm]
provider = "anthropic"
profile_order = ["primary", "fallback"]

[[llm.profiles]]
name = "primary"

# WRONG — profile_order gets absorbed into last profile entry
[[llm.profiles]]
name = "primary"

profile_order = ["primary"]  # <-- parsed as llm.profiles[0].profile_order!
```

---

## Sections

### `[nachos]` — Required

Core metadata.

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `name` | string | yes | Assistant instance name |
| `version` | string | yes | Config format version |

```toml
[nachos]
name = "my-assistant"
version = "1.0"
```

---

### `[llm]` — Required

LLM provider configuration. Credentials come from `.env`.

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `provider` | string | yes | — | `anthropic`, `openai`, `ollama`, `bedrock`, `custom` |
| `model` | string | yes | — | Model identifier |
| `fallback_order` | string[] | no | — | Fallback models as `"provider:model"` |
| `profile_order` | string[] | no | — | Auth profile evaluation order |
| `max_tokens` | number | no | — | 1–1,000,000 |
| `temperature` | number | no | — | 0–2 |
| `base_url` | string | no | — | Required for `ollama`/`custom` providers |
| `region` | string | no | — | Required for `bedrock` provider |
| `context_window` | number | no | — | Override the model's context window size in tokens |

#### `[[llm.profiles]]` — Auth Profiles

Tried in `profile_order` sequence until one succeeds.

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `name` | string | yes | Profile identifier |
| `provider` | string | yes | Provider name |
| `api_key_env` | string | yes | Environment variable containing the API key |
| `base_url` | string | no | Override base URL for this profile |

#### `[llm.retry]`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `attempts` | number | — | Max retry attempts |
| `min_delay_ms` | number | — | Minimum backoff delay |
| `max_delay_ms` | number | — | Maximum backoff delay |
| `jitter` | number | — | Jitter factor (0–1) |

#### `[llm.cooldowns]`

| Key | Type | Description |
|-----|------|-------------|
| `initial_seconds` | number | Initial cooldown period |
| `multiplier` | number | Backoff multiplier |
| `max_seconds` | number | Maximum cooldown |
| `billing_initial_hours` | number | Initial billing cooldown |
| `billing_max_hours` | number | Maximum billing cooldown |

```toml
[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
fallback_order = ["anthropic:claude-haiku"]
max_tokens = 4096
temperature = 0.7
profile_order = ["anthropic-subscription", "anthropic-primary"]

[[llm.profiles]]
name = "anthropic-subscription"
provider = "anthropic"
api_key_env = "ANTHROPIC_SETUP_TOKEN"

[[llm.profiles]]
name = "anthropic-primary"
provider = "anthropic"
api_key_env = "ANTHROPIC_API_KEY"
```

---

### `[security]` — Required

Security mode and policy configuration.

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `mode` | string | yes | `strict`, `standard`, `permissive` |
| `i_understand_the_risks` | boolean | if permissive | Must be `true` for permissive mode |

#### `[security.dlp]` — Data Loss Prevention

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | — | Enable DLP scanning |
| `action` | string | — | `block`, `warn`, `audit`, `allow`, `redact` |
| `patterns` | string[] | — | Pattern names: `credit_card`, `ssn`, `api_key`, `password` |

#### `[security.approval]`

| Key | Type | Description |
|-----|------|-------------|
| `approver_allowlist` | string[] | Users who can approve restricted operations |

#### `[security.rate_limits]`

All values must be ≥ 1.

| Key | Type | Description |
|-----|------|-------------|
| `messages_per_minute` | number | Max inbound messages per minute |
| `tool_calls_per_minute` | number | Max tool invocations per minute |
| `llm_requests_per_minute` | number | Max LLM API calls per minute |

#### `[security.audit]`

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable audit logging |
| `retention_days` | number | 1–365 |
| `log_inputs` | boolean | Log user inputs |
| `log_outputs` | boolean | Log assistant outputs |
| `log_tool_calls` | boolean | Log tool invocations |
| `provider` | string | `sqlite`, `file`, `webhook`, `custom`, `composite` |
| `providers` | string[] | Required for `composite` provider |
| `path` | string | Required for `sqlite`/`file` providers |
| `url` | string | Required for `webhook` provider |
| `headers` | Record | Headers for webhook provider |
| `rotate_size` | number | Log rotation size |
| `max_files` | number | Max rotated files |
| `batch_size` | number | Batch size (≥ 1) |
| `flush_interval_ms` | number | Flush interval (≥ 100ms) |
| `custom_path` | string | Required for `custom` provider |
| `custom_config` | Record | Custom provider configuration |

```toml
[security]
mode = "standard"

[security.dlp]
enabled = true
action = "block"  # default action — also supports "allow", "block", "redact", "warn", "audit"
patterns = ["credit_card", "ssn", "api_key", "password"]

[security.rate_limits]
messages_per_minute = 30
tool_calls_per_minute = 15
llm_requests_per_minute = 30

[security.audit]
enabled = true
retention_days = 30
log_inputs = true
log_outputs = true
log_tool_calls = true
```

---

### `[channels]` — Optional

Messaging platform connections. Each channel is optional and disabled by default.

#### `[channels.webchat]`

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable webchat |
| `port` | number | Listen port (1–65535) |

#### `[channels.slack]`

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable Slack |
| `mode` | string | `socket` (default) or `http` |
| `app_token` | string | Required for socket mode |
| `bot_token` | string | Required for both modes |
| `signing_secret` | string | Required for http mode |
| `webhook_path` | string | Required for http mode |
| `typing_indicators` | boolean | Show typing indicators |

#### `[channels.discord]`

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable Discord |
| `token` | string | Bot token (required when enabled) |
| `allow_bots` | boolean | Accept messages from bots |
| `bot_allowlist` | string[] | Allowed bot user IDs (if `allow_bots` is true) |
| `typing_indicators` | boolean | Show typing indicators |

##### `[channels.discord.status_emojis]`

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable status emoji reactions |

#### `[channels.telegram]`

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable Telegram |
| `token` | string | Bot token (required when enabled) |

#### `[channels.whatsapp]`

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable WhatsApp |
| `token` | string | API token (required when enabled) |
| `phone_number_id` | string | Required |
| `verify_token` | string | Required |
| `webhook_path` | string | Required |
| `api_version` | string | Meta API version |
| `app_secret` | string | App secret for signature verification |

#### `[channels.matrix]`

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable Matrix |
| `homeserver_url` | string | Matrix homeserver URL (required when enabled) |
| `access_token` | string | Bot access token (required when enabled) |
| `user_id` | string | Bot user ID (e.g., `@bot:matrix.org`) |
| `device_id` | string | Device ID for E2EE sessions |

#### Channel Sub-Sections (all channels except webchat)

**`[channels.<name>.commands]`** (Slack, Discord)

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | string[] | Enabled command names |
| `admin_allowlist` | string[] | Admin-only command users |

**`[channels.<name>.dm]`**

| Key | Type | Description |
|-----|------|-------------|
| `user_allowlist` | string[] | Users allowed to DM the bot |
| `pairing` | boolean | Enable pairing-based DM access |

**`[[channels.<name>.servers]]`**

| Key | Type | Description |
|-----|------|-------------|
| `id` | string | Single server ID (deprecated, use `ids`) |
| `ids` | string[] | Server/guild IDs |
| `channel_ids` | string[] | Allowed channel IDs |
| `user_allowlist` | string[] | Allowed user IDs |
| `mention_gating` | boolean | Require @mention to respond |

---

### `[tools]` — Optional

Tool configurations. Each tool is independently enabled/disabled.

#### `[tools.filesystem]`

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable filesystem access |
| `paths` | string[] | Allowed paths |
| `write` | boolean | Allow write operations |
| `max_file_size` | string | Max file size (e.g., `"10MB"`) |

#### `[tools.browser]`

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable browser tool (default: `false` — must be explicitly enabled) |
| `allowed_domains` | string[] | Allowed domains (default: `[]` — requires explicit domain configuration) |
| `headless` | boolean | Run headless |
| `timeout` | number | Timeout in seconds (≥ 1) |

#### `[tools.code_runner]`

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable code execution |
| `runtime` | string | `sandboxed` or `native` (`native` requires permissive mode) |
| `languages` | string[] | Allowed languages |
| `timeout` | number | Timeout in seconds (≥ 1) |
| `max_memory` | string | Memory limit (e.g., `"256MB"`) |

#### `[tools.shell]`

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable shell access (**requires permissive mode**) |

#### `[tools.web_search]`

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable web search |
| `api_key_env` | string | Env var for search API key |
| `default_country` | string | Default country code |
| `safe_search` | string | `off`, `moderate`, `strict` |
| `max_results` | number | Max results per query |

#### `[tools.web_fetch]`

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable URL fetching |
| `allowed_domains` | string[] | Allowed domains |
| `domain_allowlist` | string[] | Domain allowlist (alternative) |
| `max_chars` | number | Max response characters |
| `timeout_ms` | number | Timeout in milliseconds |
| `timeout_seconds` | number | Timeout in seconds |
| `max_redirects` | number | Max redirect follows |
| `user_agent` | string | Custom user agent |

#### `[tools.bootstrap]`

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable bootstrap tool |

#### `[tools.github]`

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable GitHub integration |
| `default_repo` | string | Default repository |
| `token_env` | string | Env var for GitHub token |
| `repo_allowlist` | string[] | Allowed repositories |

#### `[tools.bitbucket]`

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable Bitbucket integration |
| `default_workspace` | string | Default workspace |
| `auth_type` | string | `app_password` or `oauth` |
| `username_env` | string | Env var for username |
| `password_env` | string | Env var for password |
| `token_env` | string | Env var for OAuth token |
| `workspace_allowlist` | string[] | Allowed workspaces |

#### `[tools.composio]`

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable Composio integration |
| `api_key_env` | string | Env var for API key |
| `entity_id` | string | Entity identifier |
| `allowed_apps` | string[] | Allowed Composio apps |

#### `[tools.copilot]`

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable copilot tool |
| `max_prompt_length` | number | Max prompt length |
| `max_output_size` | number | Max output size |
| `default_timeout` | number | Default timeout |
| `max_timeout` | number | Maximum timeout |

#### `[tools.groups.<name>]` — Tool Groups

Group tools for policy purposes.

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable this group |
| `tools` | string[] | Tool names in this group |
| `description` | string | Group description |

```toml
[tools.groups.lookup]
tools = ["web_fetch", "goplaces"]

[tools.groups.media]
tools = ["gifgrep"]
```

---

### `[runtime]` — Optional

Runtime behavior and storage configuration.

| Key | Type | Description |
|-----|------|---------|
| `state_dir` | string | State storage directory |
| `config_dir` | string | Config directory (non-empty) |
| `workspace_dir` | string | Workspace directory (non-empty) |
| `log_level` | string | `debug`, `info`, `warn`, `error` |
| `log_format` | string | `pretty`, `json` |
| `redis_url` | string | Redis URL (valid URL format) |
| `gateway_streaming_passthrough` | boolean | Stream LLM responses through gateway |
| `gateway_streaming_chunk_size` | number | Chunk size (≥ 1) |
| `gateway_streaming_min_interval_ms` | number | Min interval between chunks (≥ 0) |

#### `[runtime.resources]`

| Key | Type | Description |
|-----|------|-------------|
| `memory` | string | Memory limit (e.g., `"512MB"`) |
| `cpus` | number | CPU limit (> 0) |
| `pids_limit` | number | Process limit (≥ 1) |

#### `[runtime.state.*]` — State Layer

Storage backends for different data types.

**`[runtime.state.identity]`, `[runtime.state.memory]`, `[runtime.state.user_profile]`, `[runtime.state.bootstrap]`**

| Key | Type | Description |
|-----|------|-------------|
| `provider` | string | `filesystem` or `postgres` |
| `filesystem.dir` | string | Storage directory |
| `postgres.connection_string` | string | PostgreSQL connection string |
| `postgres.schema` | string | Database schema |
| `postgres.ssl` | boolean | Use SSL |
| `postgres.max_connections` | number | Connection pool size |

**`[runtime.state.session]`** — Active Session State

| Key | Type | Description |
|-----|------|-------------|
| `provider` | string | `redis` or `memory` |
| `redis_url` | string | Redis URL (falls back to `runtime.redis_url`) |
| `ttl_seconds` | number | Session TTL |

**`[runtime.state.sessions]`** — Conversation History

| Key | Type | Description |
|-----|------|-------------|
| `provider` | string | `sqlite` or `postgres` |
| `sqlite.db_path` | string | SQLite database path |
| `postgres.connection_string` | string | PostgreSQL connection string |
| `postgres.schema` | string | Database schema |
| `postgres.ssl` | boolean | Use SSL |
| `postgres.max_connections` | number | Connection pool size |

**`[runtime.state.semantic]`** — Semantic Search

| Key | Type | Description |
|-----|------|-------------|
| `provider` | string | `local` |
| `local.model` | string | Embedding model name |
| `local.cache_dir` | string | Embedding cache directory |

**`[runtime.state.prompt_report]`**

| Key | Type | Description |
|-----|------|-------------|
| `hash` | string | Hash algorithm (`sha256`) |
| `include_tokens` | boolean | Include token counts |
| `max_memory_entries` | number | Max memory entries |
| `max_memory_facts` | number | Max memory facts |
| `include_session_state` | boolean | Include session state |

#### `[runtime.context_management]` — Context Window Management

**`[runtime.context_management.sliding_window]`**

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable sliding window |
| `mode` | string | `token-based`, `message-based`, `hybrid` |
| `thresholds.proactive_prune` | number | Proactive prune threshold |
| `thresholds.light_compaction` | number | Light compaction threshold |
| `thresholds.aggressive_compaction` | number | Aggressive compaction threshold |
| `thresholds.emergency` | number | Emergency threshold |
| `keep_recent.turns` | number | Recent turns to keep |
| `keep_recent.messages` | number | Recent messages to keep |
| `keep_recent.token_budget` | number | Token budget for recent items |
| `slide_strategy` | string | `chunk`, `message`, `turn` |
| `chunk_size` | number | Slide chunk size |

**`[runtime.context_management.summarization]`**

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable summarization |
| `mode` | string | `single` or `multi-tier` |
| `tiers.<name>.compression_ratio` | number | Compression ratio per tier |
| `tiers.<name>.format` | string | `bullet-points`, `structured-summary`, `detailed-summary` |
| `tiers.<name>.preserves` | string[] | Content types to preserve |
| `content_classification.enabled` | boolean | Enable content classification |
| `content_classification.preserve_critical` | boolean | Preserve critical content |
| `content_classification.preserve_code` | boolean | Preserve code blocks |
| `content_classification.preserve_errors` | boolean | Preserve error messages |
| `custom_instructions` | string | Custom summarization instructions |

Tier names: `archival`, `compressed`, `condensed`.

**`[runtime.context_management.proactive_history]`**

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable proactive history extraction |
| `extractors.decisions` | boolean | Extract decisions |
| `extractors.facts` | boolean | Extract facts |
| `extractors.tasks` | boolean | Extract tasks |
| `extractors.issues` | boolean | Extract issues |
| `extractors.files` | boolean | Extract file references |
| `triggers.on_compaction` | boolean | Trigger on compaction |
| `triggers.on_threshold` | number | Trigger at threshold |
| `triggers.on_memory_flush` | boolean | Trigger on memory flush |
| `triggers.periodic` | string | Periodic trigger (e.g., `"1h"`) |
| `snapshots.enabled` | boolean | Enable snapshots |
| `snapshots.dir` | string | Snapshot directory |
| `snapshots.max_snapshots` | number | Max snapshots to keep |
| `summary_archive.enabled` | boolean | Enable summary archive |
| `summary_archive.dir` | string | Archive directory |
| `summary_archive.max_summaries` | number | Max summaries to keep |
| `custom_pattern_files` | string[] | Custom extraction pattern files |

**`[runtime.context_management.memory_flush]`**

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable memory flush |
| `soft_threshold_tokens` | number | Token threshold for soft flush |
| `extract_structured` | boolean | Extract structured data |
| `create_snapshot` | boolean | Create snapshot on flush |
| `validate_extraction` | boolean | Validate extracted data |
| `system_prompt` | string | System prompt for extraction |
| `prompt` | string | Extraction prompt |

**`[runtime.context_management.commands]`**

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable context commands |
| `allow_in_dms` | boolean | Allow in DMs |
| `allow_in_channels` | boolean | Allow in channels |
| `admin_allowlist` | string[] | Admin users |
| `reset_triggers` | string[] | Reset command triggers |
| `context_triggers` | string[] | Context command triggers |
| `identity_triggers` | string[] | Identity command triggers |

#### `[runtime.subagents]` — Subagent Configuration

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable subagents |
| `max_concurrent` | number | Max concurrent subagents |

**`[runtime.subagents.announce]`**

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Announce subagent activity |
| `prompt` | string | Announcement prompt |

**`[runtime.subagents.tools]`**

| Key | Type | Description |
|-----|------|-------------|
| `allow` | string[] | Global tool allowlist |
| `deny` | string[] | Global tool denylist |
| `default_profile` | string | Default tool profile (must exist in `profiles`) |

**`[runtime.subagents.tools.profiles.<name>]`**

| Key | Type | Description |
|-----|------|-------------|
| `allow` | string[] | Tools allowed for this profile |
| `deny` | string[] | Tools denied for this profile |

**`[runtime.subagents.sandbox]`**

| Key | Type | Description |
|-----|------|-------------|
| `mode` | string | `host`, `tool`, `full` |

**`[runtime.subagents.sandbox.docker]`** (required when `mode = "full"`)

| Key | Type | Description |
|-----|------|-------------|
| `image` | string | Docker image (required for full mode) |
| `network` | string | `none`, `egress`, `full` |
| `workspace_dir` | string | Workspace directory |
| `config_dir` | string | Config directory |
| `state_dir` | string | State directory |
| `timeout_ms` | number | Execution timeout |

#### `[runtime.sandbox]` — Tool Sandboxing

| Key | Type | Description |
|-----|------|-------------|
| `mode` | string | `off`, `non-main`, `all` |
| `scope` | string | `session`, `agent`, `shared` |
| `workspace_access` | string | `none`, `ro`, `rw` |
| `extra_binds` | string[] | Extra bind mounts |
| `env` | Record | Environment variables |
| `setup_command` | string | Setup command to run |
| `network` | string | `none`, `egress`, `full` |

---

### `[assistant]` — Optional

| Key | Type | Description |
|-----|------|-------------|
| `name` | string | Assistant display name |
| `system_prompt` | string | System prompt (supports multi-line `"""..."""`) |

---

### `[skills]` — Optional

Skill-backed CLI tool configuration.

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | string[] | Deprecated alias for `allow` |
| `allow` | string[] | Allowlisted skills (if set, only these load) |
| `deny` | string[] | Denylisted skills |
| `entries` | Record | Per-skill overrides (`{ enabled: boolean }`) |
| `hot_reload` | boolean | Hot reload on file change |
| `debounce_ms` | number | Debounce delay for reloads |

---

### `[admin]` — Optional

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable admin UI |
| `port` | number | Admin UI port |

---

### `[scheduler]` — Optional

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable scheduled tasks |
| `check_interval_seconds` | number | How often to check for due tasks |
| `max_concurrent_jobs` | number | Max concurrent jobs |
| `run_missed_on_startup` | boolean | Run missed jobs on startup |

#### `[[scheduler.jobs]]` — Scheduled Job Definitions

Array of declarative job definitions synced to the SQLite job registry on startup.

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `name` | string | yes | Unique job identifier |
| `description` | string | no | Human-readable description |
| `schedule_type` | string | yes | `at` (one-shot ISO timestamp), `every` (interval ms), `cron` (5-field cron) |
| `schedule_value` | string | yes | ISO timestamp, milliseconds, or cron expression |
| `timezone` | string | no | IANA timezone for cron schedules |
| `action_type` | string | yes | `systemEvent` or `agentTurn` |
| `action_text` | string | no | Text to inject (for `systemEvent`) |
| `action_prompt` | string | no | Prompt for the LLM (for `agentTurn`) |
| `delivery_channel` | string | no | Target channel to deliver job output |
| `enabled` | boolean | no | Whether this job is active |

---

### `[sessions]` — Optional

Session lifecycle configuration.

#### `[sessions]`

| Key | Type | Description |
|-----|------|-------------|
| `inactivity_timeout` | number | Close inactive sessions after this many seconds |
| `archive_ttl` | number | Delete archived sessions after this many seconds |

---

### `[heartbeat]` — Optional

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Enable heartbeat messages |
| `interval_minutes` | number | Heartbeat interval |
| `prompt` | string | Heartbeat prompt |
| `channel` | string | Target channel |

---

## Cross-Field Validation Rules

| Rule | Error |
|------|-------|
| `security.mode = "permissive"` | Requires `security.i_understand_the_risks = true` |
| `tools.shell.enabled = true` | Requires `security.mode = "permissive"` |
| `tools.code_runner.runtime = "native"` | Requires `security.mode = "permissive"` |
| `llm.provider = "bedrock"` | Requires `llm.region` |
| `llm.provider = "ollama"` | Warns if `llm.base_url` not set |
| `runtime.subagents.tools.default_profile` | Must exist in `profiles` map |
| `runtime.subagents.sandbox.mode = "full"` | Requires `sandbox.docker.image` |
| `runtime.state.session.provider = "redis"` | Requires `redis_url` (session or runtime) |
| `security.audit.provider = "sqlite"/"file"` | Requires `audit.path` |
| `security.audit.provider = "webhook"` | Requires `audit.url` |
| `security.audit.provider = "custom"` | Requires `audit.custom_path` |
| `security.audit.provider = "composite"` | Requires non-empty `audit.providers` |

---

## Maintaining Parity

The config system has three layers that must stay in sync:

1. **Schema types** (`schema.ts`) — TypeScript interfaces defining the config shape
2. **CONFIG_SHAPE** (`validation.ts`) — Structural allowlist for unknown-key detection
3. **Validation functions** (`validation.ts`) — Semantic validation rules

When adding a new config key:

1. Add the type to the appropriate interface in `schema.ts`
2. Add the key to `CONFIG_SHAPE` in `validation.ts` (nested to match the type)
3. Add semantic validation if needed (value ranges, cross-field rules)
4. Export the type from `index.ts` if consumers need it
5. **Rebuild the dist** (`pnpm build` in `packages/shared/config`)
6. Update this documentation

**Common pitfall**: Editing source but not rebuilding dist. The gateway loads
from `dist/`, so source-only changes have no effect at runtime.
