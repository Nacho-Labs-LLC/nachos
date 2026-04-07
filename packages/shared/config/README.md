# @nachos/config

Configuration system for Nachos - provides TOML parsing, .env loading,
environment variable overlays, validation, and policy hot-reload support.

## Configuration Tiers

Nachos uses a layered configuration model. Lower tiers are sufficient for simple
setups; higher tiers unlock more control.

### Tier 1 — Env vars only (quick start, single channel)

Channel adapters (Discord, Slack, Telegram, etc.) work without a `nachos.toml`.
Set tokens and access rules entirely in `.env`:

```bash
# Channel identity
DISCORD_BOT_TOKEN=your-token
CHANNEL_DISCORD_ENABLED=true

# Which guild and users can talk to the bot
CHANNEL_DISCORD_GUILD_ID=123456789
CHANNEL_DISCORD_CHANNEL_IDS=          # empty = allow all channels in the guild
CHANNEL_DISCORD_USER_ALLOWLIST=111,222 # required — empty = deny all users
CHANNEL_DISCORD_MENTION_GATING=false

# Security mode
SECURITY_MODE=standard
```

> **Note**: The gateway always requires a `nachos.toml` (for LLM provider config
> at minimum). Only channel containers are fully env-configurable.

**Works for**: single guild, single allowlist, standard security mode, all
tokens as secrets.

**Requires TOML for**: multi-guild, per-guild policies, assistant system prompt,
custom LLM settings.

---

### Tier 2 — nachos.toml + env var overlay (recommended)

`nachos.toml` defines the base config. `.env` overlays secrets and targeted
overrides on top. Standard setup for most deployments.

**Priority order (highest wins):**

```text
shell environment / .env
    ↓ overlays on
nachos.toml
    ↓ discovered from
$NACHOS_CONFIG_PATH  →  ./nachos.toml  →  ~/.nachos/nachos.toml
```

Env vars map to TOML paths using a flat `SECTION_KEY` naming convention. See
[Environment Variables](#environment-variables) below. Structured fields (arrays
of objects like `servers`) cannot be set via env vars — use TOML for those.

---

### Tier 3 — Full nachos.toml (multi-guild, complex policies)

For multiple guilds, per-server channel/user allowlists, or advanced policy
rules, all channel server config lives in TOML. Env vars still overlay on top —
use them for secrets, never for structured allowlists.

```toml
[[channels.discord.servers]]
id = "guild-1"
channel_ids = ["channel-a", "channel-b"]
user_allowlist = ["user-1"]
mention_gating = true

[[channels.discord.servers]]
id = "guild-2"
channel_ids = []           # empty = allow all channels
user_allowlist = ["user-1", "user-2"]
```

---

## Features

- ✅ **TOML Parsing**: Parse `nachos.toml` configuration files
- ✅ **Type-Safe**: Complete TypeScript types for all configuration options
- ✅ **Dotenv**: Load `.env` files into `process.env`
- ✅ **Environment Variables**: Override TOML scalar values with env vars
- ✅ **Validation**: Comprehensive validation with clear error messages
- ✅ **Policy Hot-Reload**: Watch `policies/*.yaml` for changes without restart
  (config changes always require restart)
- ✅ **Flexible**: Load from custom paths or auto-discovered locations

## Installation

This is a workspace package and is not published separately.

```bash
pnpm add @nachos/config
```

## Quick Start

### Basic Usage

```typescript
import { loadAndValidateConfig } from '@nachos/config';

// Load .env, overlay with env vars, and validate
const config = loadAndValidateConfig();

console.log(config.llm.provider); // "anthropic"
console.log(config.security.mode); // "standard"
```

### Custom Path

```typescript
import { loadAndValidateConfig } from '@nachos/config';

const config = loadAndValidateConfig({
  configPath: '/path/to/nachos.toml',
  envFilePath: '/path/to/.env',
});
```

### Without Validation

```typescript
import { loadAndValidateConfig } from '@nachos/config';

// Skip validation (not recommended)
const config = loadAndValidateConfig({
  validate: false,
});
```

### Without Environment Overlay

```typescript
import { loadAndValidateConfig } from '@nachos/config';

// Don't apply environment variables
const config = loadAndValidateConfig({
  applyEnv: false,
});
```

### Without Dotenv Loading

```typescript
import { loadAndValidateConfig } from '@nachos/config';

// Don't load a .env file
const config = loadAndValidateConfig({
  applyDotenv: false,
});
```

## Environment Variables

Override any configuration value with environment variables. If a `.env` file is
present, it is loaded into `process.env` before applying overrides.

```bash
# LLM Configuration
export LLM_PROVIDER="openai"
export LLM_MODEL="gpt-4"
export LLM_FALLBACK_ORDER="anthropic:claude-haiku,openai:gpt-4o-mini"
export LLM_MAX_TOKENS="8192"
export LLM_TEMPERATURE="0.7"

# Security Configuration
export SECURITY_MODE="strict"
export SECURITY_DLP_ENABLED="true"
export SECURITY_DLP_ACTION="block"
export SECURITY_RATE_LIMIT_MESSAGES="30"
export SECURITY_RATE_LIMIT_TOOLS="15"
export SECURITY_RATE_LIMIT_LLM="30"
export RUNTIME_REDIS_URL="redis://localhost:6379"

# Channel Configuration
export CHANNEL_WEBCHAT_ENABLED="true"
export CHANNEL_WEBCHAT_PORT="8080"
export CHANNEL_SLACK_ENABLED="true"
export CHANNEL_SLACK_MODE="socket"
export CHANNEL_SLACK_APP_TOKEN="xapp-..."
export CHANNEL_SLACK_BOT_TOKEN="xoxb-..."
export CHANNEL_SLACK_SIGNING_SECRET="..."
export CHANNEL_SLACK_WEBHOOK_PATH="/slack/events"
export CHANNEL_DISCORD_ENABLED="true"
export CHANNEL_DISCORD_TOKEN="..."
export CHANNEL_TELEGRAM_ENABLED="true"
export CHANNEL_TELEGRAM_TOKEN="..."
export CHANNEL_WHATSAPP_ENABLED="true"
export CHANNEL_WHATSAPP_TOKEN="..."
export CHANNEL_WHATSAPP_PHONE_NUMBER_ID="..."
export CHANNEL_WHATSAPP_VERIFY_TOKEN="..."
export CHANNEL_WHATSAPP_WEBHOOK_PATH="/whatsapp/webhook"
export CHANNEL_WHATSAPP_API_VERSION="v20.0"
export CHANNEL_WHATSAPP_APP_SECRET="..."

# Tool Configuration
export TOOL_FILESYSTEM_ENABLED="true"
export TOOL_BROWSER_ENABLED="true"
export TOOL_CLAUDE_CODE_MCP_ENABLED="true"
```

See [env.ts](./src/env.ts) for the complete list of supported environment
variables.

## Hot-Reload for Policy Files

Watch a directory for policy file changes:

```typescript
import { createPolicyWatcher } from '@nachos/config';

const watcher = createPolicyWatcher('./policies', (filePath, content) => {
  console.log(`Policy file changed: ${filePath}`);
  // Reload policy file
});

// Later, stop watching
await watcher.stop();
```

## Notes

- Config is loaded from TOML + environment variables only. Changes require a
  restart.

## Advanced Usage

### Manual Loading and Validation

```typescript
import { loadConfig, applyEnvOverlay, validateConfig } from '@nachos/config';

// Load base config
const baseConfig = loadConfig('./nachos.toml');

// Apply environment variables
const config = applyEnvOverlay(baseConfig);

// Validate
const result = validateConfig(config);
if (!result.valid) {
  console.error('Validation errors:', result.errors);
  process.exit(1);
}

if (result.warnings.length > 0) {
  console.warn('Warnings:', result.warnings);
}
```

### Parse TOML Directly

```typescript
import { parseToml } from '@nachos/config';

const tomlString = `
[nachos]
name = "my-assistant"
version = "1.0"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-6"

[security]
mode = "standard"
`;

const config = parseToml(tomlString);
```

## Configuration Schema

See [schema.ts](./src/schema.ts) for the complete TypeScript schema.

### Required Sections

- `[nachos]` - Core settings (name, version)
- `[llm]` - LLM provider configuration
- `[security]` - Security settings

### Optional Sections

- `[channels.*]` - Messaging platform configurations
- `[tools.*]` - Tool capabilities
- `[runtime]` - Runtime settings
- `[assistant]` - Assistant personality
- `[skills]` - Pre-configured skill bundles

## Validation Rules

The validator checks:

- ✅ All required sections are present
- ✅ Required fields have values
- ✅ Enums match allowed values
- ✅ Numbers are within valid ranges
- ✅ Security constraints are met
- ✅ Tool permissions match security mode

### Security Rules

- `security.mode = "permissive"` requires `i_understand_the_risks = true`
- `tools.shell.enabled = true` requires `security.mode = "permissive"`
- `tools.code_runner.runtime = "native"` requires `security.mode = "permissive"`

## Error Handling

All errors extend the base `Error` class:

```typescript
import { ConfigLoadError, ConfigValidationError } from '@nachos/config';

try {
  const config = loadAndValidateConfig();
} catch (error) {
  if (error instanceof ConfigLoadError) {
    console.error('Failed to load config:', error.message);
  } else if (error instanceof ConfigValidationError) {
    console.error('Invalid config:', error.errors);
  }
}
```

## Testing

Run tests:

```bash
pnpm test packages/shared/config
```

## License

MIT
