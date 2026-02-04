# @nachos/config

Configuration system for Nachos - provides TOML parsing, environment variable overlays, validation, and hot-reload support.

## Features

- ✅ **TOML Parsing**: Parse `nachos.toml` configuration files
- ✅ **Type-Safe**: Complete TypeScript types for all configuration options
- ✅ **Environment Variables**: Override TOML values with environment variables
- ✅ **Validation**: Comprehensive validation with clear error messages
- ✅ **Hot-Reload**: Watch policy files for changes and reload automatically
- ✅ **Flexible**: Load from custom paths or default search locations

## Installation

This is a workspace package and is not published separately.

```bash
pnpm add @nachos/config
```

## Quick Start

### Basic Usage

```typescript
import { loadAndValidateConfig } from '@nachos/config';

// Load, overlay with env vars, and validate
const config = loadAndValidateConfig();

console.log(config.llm.provider); // "anthropic"
console.log(config.security.mode); // "standard"
```

### Custom Path

```typescript
import { loadAndValidateConfig } from '@nachos/config';

const config = loadAndValidateConfig({
  configPath: '/path/to/nachos.toml',
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

## Environment Variables

Override any configuration value with environment variables:

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
```

See [env.ts](./src/env.ts) for the complete list of supported environment variables.

## Hot-Reload for Policy Files

Watch a directory for policy file changes:

```typescript
import { createPolicyWatcher } from '@nachos/config';

const watcher = createPolicyWatcher(
  './policies',
  (filePath, content) => {
    console.log(`Policy file changed: ${filePath}`);
    // Reload policy file
  }
);

// Later, stop watching
await watcher.stop();
```

## Advanced Usage

### Manual Loading and Validation

```typescript
import {
  loadConfig,
  applyEnvOverlay,
  validateConfig,
} from '@nachos/config';

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
model = "claude-sonnet-4-20250514"

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
import {
  ConfigLoadError,
  ConfigValidationError,
} from '@nachos/config';

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
