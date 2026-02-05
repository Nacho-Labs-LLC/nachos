# @nachos/cli

The official Nachos CLI for managing your Nachos stack.

## Installation

```bash
# Install dependencies
pnpm install

# Build the CLI
pnpm build

# Link globally for development
pnpm link --global
```

## Usage

```bash
nachos [command] [options]
```

### Global Options

- `--json` - Output results as JSON (all commands)
- `--verbose` - Enable verbose output
- `--help` - Show help for a command
- `--version` - Show CLI version

## Commands

### Stack Management

#### `nachos init`

Initialize a new Nachos project with interactive prompts.

```bash
nachos init [options]

Options:
  --defaults    Use default values without prompts
  --force       Overwrite existing configuration
```

Creates:
- `nachos.toml` - Main configuration file
- `.env` - Environment variables (API keys)
- `policies/` - Security policy files
- `workspace/` - Tool workspace directory
- `state/` - Application state directory

#### `nachos up`

Start the Nachos stack.

```bash
nachos up [options]

Options:
  --build    Build images before starting
  --wait     Wait for services to be healthy
```

This command:
1. Validates configuration
2. Generates `docker-compose.generated.yml`
3. Starts all services using Docker Compose
4. Displays service URLs

#### `nachos down`

Stop the Nachos stack.

```bash
nachos down [options]

Options:
  --volumes    Remove volumes
```

#### `nachos restart`

Restart the Nachos stack (down + up with fresh compose generation).

```bash
nachos restart
```

Useful when you've made configuration changes and want to apply them.

#### `nachos status`

Show the current status of all services.

```bash
nachos status
```

Displays:
- Container states (running/stopped)
- Health status
- Service URLs

#### `nachos logs`

View service logs.

```bash
nachos logs [service] [options]

Options:
  -f, --follow           Follow log output
  --tail <lines>         Number of lines to show (default: 50)
  -t, --timestamps       Show timestamps
```

Examples:
```bash
# View all logs
nachos logs

# View gateway logs
nachos logs gateway

# Follow bus logs
nachos logs -f bus

# Last 100 lines of webchat logs
nachos logs webchat --tail 100
```

### Configuration

#### `nachos config validate`

Validate your `nachos.toml` configuration.

```bash
nachos config validate
```

#### `nachos policy validate`

Validate policy YAML files.

```bash
nachos policy validate
```

Checks all `.yaml` and `.yml` files in the `policies/` directory.

### Module Management

#### `nachos add channel <name>`

Add a channel configuration stub to `nachos.toml`.

```bash
nachos add channel <name>

Valid channels:
  - webchat
  - slack
  - discord
  - telegram
  - whatsapp
```

Example:
```bash
nachos add channel slack
```

This adds a commented configuration stub. You'll need to:
1. Edit `nachos.toml` to set `enabled = true`
2. Configure channel-specific settings
3. Add required secrets to `.env`
4. Run `nachos restart`

#### `nachos add tool <name>`

Add a tool configuration stub to `nachos.toml`.

```bash
nachos add tool <name>

Valid tools:
  - filesystem
  - browser
  - code_runner
  - shell
  - web_search
```

Example:
```bash
nachos add tool browser
```

#### `nachos remove <type> <name>`

Remove a module from configuration.

```bash
nachos remove <type> <name> [options]

Types:
  - channel
  - tool
  - skill

Options:
  --force    Skip confirmation prompt
```

Examples:
```bash
# Remove slack channel (with confirmation)
nachos remove channel slack

# Remove browser tool (skip confirmation)
nachos remove tool browser --force
```

#### `nachos list`

List all configured modules.

```bash
nachos list
```

Shows:
- Enabled/disabled channels
- Enabled/disabled tools
- Enabled/disabled skills

### Diagnostics

#### `nachos doctor`

Run comprehensive health checks.

```bash
nachos doctor
```

Checks:
- ✓ Docker installed and running
- ✓ Docker Compose V2 available
- ✓ Node.js 22+ installed
- ✓ pnpm 9+ installed
- ✓ `nachos.toml` exists
- ✓ `nachos.toml` validates
- ⚠ Required environment variables
- ✓ Policy files valid
- ✓ Required ports available (3000, 8080, 4222, 6379)
- ✓ Sufficient disk space (>10GB)
- ✓ Generated compose file exists
- ✓ Container health (if running)

Exit codes:
- `0` - All checks passed
- `1` - One or more checks failed

#### `nachos debug`

Show debug information about your Nachos installation.

```bash
nachos debug
```

Displays:
- CLI version
- Node.js version
- Platform and architecture
- Config file location
- Docker/Compose versions
- Environment variables

## JSON Output

All commands support `--json` for machine-readable output:

```bash
nachos status --json
```

Output format:
```json
{
  "ok": true,
  "command": "status",
  "data": {
    "running": true,
    "containers": [...],
    "urls": {...}
  },
  "meta": {
    "timestamp": "2026-02-04T22:00:00.000Z",
    "version": "0.0.0",
    "config_path": "/path/to/nachos.toml",
    "duration_ms": 123
  }
}
```

Error format:
```json
{
  "ok": false,
  "command": "up",
  "error": {
    "code": "DOCKER_NOT_AVAILABLE",
    "message": "Docker is not available",
    "details": null
  },
  "meta": {
    "timestamp": "2026-02-04T22:00:00.000Z",
    "version": "0.0.0",
    "duration_ms": 45
  }
}
```

## Exit Codes

- `0` - Success
- `1` - General error
- `2` - Configuration error
- `3` - Docker/Compose error
- `4` - Validation error

## Configuration Discovery

The CLI searches for `nachos.toml` in the following order:

1. `$NACHOS_CONFIG_PATH` environment variable
2. Current directory (`./nachos.toml`)
3. Parent directories (walking up the tree)
4. Home directory (`~/.nachos/nachos.toml`)

## Configuration Precedence

Nachos uses a layered configuration system. Values are resolved in the following order (highest to lowest priority):

1. **Environment Variables** (highest priority)
   - `SECURITY_MODE` - Override security mode
   - `ANTHROPIC_API_KEY` - Anthropic API key
   - `OPENAI_API_KEY` - OpenAI API key
   - Channel-specific keys (e.g., `SLACK_BOT_TOKEN`)

2. **`.env` File**
   - Loaded automatically from project root
   - Never commit this file to version control
   - Used for secrets and local overrides

3. **`nachos.toml`** (lowest priority)
   - Main configuration file
   - Defines structure and defaults
   - Should be committed to version control

### Configuration vs Secrets

**What goes in `nachos.toml`:**

- Project structure (`nachos.name`, `nachos.version`)
- LLM provider and model selection
- Security mode and policies
- Channel/tool enabled flags
- Rate limits and audit settings

**What goes in `.env`:**

- API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)
- Bot tokens (`SLACK_BOT_TOKEN`, `DISCORD_BOT_TOKEN`)
- Local environment overrides
- Development-specific settings

**Example:**

```toml
# nachos.toml (committed to git)
[llm]
provider = "anthropic"
model = "claude-3-5-sonnet-20241022"

[security]
mode = "standard"
```

```bash
# .env (NOT committed to git)
ANTHROPIC_API_KEY=sk-ant-...
SECURITY_MODE=permissive  # Override for local development
```

### Environment Overlay

The `@nachos/config` package automatically applies environment variable overlays:

```typescript
// Internally, the CLI does:
const config = loadAndValidateConfig({ configPath });
// This applies env overlays and validates the final result
```

Environment variables follow this naming pattern:

- `SECURITY_MODE` → `security.mode`
- `LLM_PROVIDER` → `llm.provider`
- API keys are passed directly to services via Docker env

## Environment Variables

- `NACHOS_CONFIG_PATH` - Override config file location
- `NODE_ENV` - Node environment (development/production)
- `DEBUG` - Enable debug output
- `SECURITY_MODE` - Override security mode (strict/standard/permissive)
- `ANTHROPIC_API_KEY` - Anthropic Claude API key
- `OPENAI_API_KEY` - OpenAI API key
- `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET` - Slack credentials
- `DISCORD_BOT_TOKEN` - Discord bot token
- `TELEGRAM_BOT_TOKEN` - Telegram bot token

## Examples

### Quick Start

```bash
# Initialize a new project
nachos init

# Add your API key to .env
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env

# Start the stack
nachos up

# Check status
nachos status

# View logs
nachos logs -f
```

### Adding Channels

```bash
# Add Slack channel
nachos add channel slack

# Edit nachos.toml to configure Slack
# Add SLACK_BOT_TOKEN to .env

# Restart to apply changes
nachos restart
```

### Debugging Issues

```bash
# Run health checks
nachos doctor

# View debug information
nachos debug

# Validate configuration
nachos config validate

# Check policy files
nachos policy validate
```

### Development Workflow

```bash
# Make config changes
vim nachos.toml

# Validate changes
nachos config validate

# Restart with new config
nachos restart

# Monitor logs
nachos logs -f gateway
```

## Development

### Building

```bash
pnpm build
```

### Type Checking

```bash
pnpm typecheck
```

### Development Mode

```bash
pnpm dev
```

## Architecture

### Core Modules

- **`cli.ts`** - Main CLI program with Commander.js
- **`core/config-discovery.ts`** - Config file discovery
- **`core/compose-generator.ts`** - Docker Compose generation
- **`core/docker-client.ts`** - Docker/Compose wrapper
- **`core/output.ts`** - Output formatting (pretty + JSON)
- **`core/errors.ts`** - Custom error types

### Commands

All commands follow a consistent pattern:
1. Accept options (including `--json`)
2. Create `OutputFormatter`
3. Perform operation
4. Output results (pretty or JSON)
5. Handle errors with suggestions

### Doctor Checks

The `doctor` command runs modular health checks:
- `checks/docker.ts` - Docker availability
- `checks/config.ts` - Configuration validation
- `checks/dependencies.ts` - Node.js, pnpm versions
- `checks/env.ts` - Environment variables
- `checks/policies.ts` - Policy file validation
- `checks/ports.ts` - Port availability
- `checks/disk.ts` - Disk space
- `checks/compose.ts` - Compose file and container health

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for development guidelines.

## License

MIT
