# Configuration Reference

**Status**: Draft - Coming Soon

Complete reference for configuring Nachos via `nachos.toml`.

## Contents

- [Configuration File Structure](#configuration-file-structure)
- [Core Settings](#core-settings)
- [LLM Configuration](#llm-configuration)
- [Channel Configuration](#channel-configuration)
- [Tool Configuration](#tool-configuration)
- [Security Settings](#security-settings)
- [Advanced Options](#advanced-options)

## Configuration File Structure

Nachos uses a single `nachos.toml` file for all configuration. See [nachos.toml.example](../nachos.toml.example) for a complete example.

You can override the default search path with the `NACHOS_CONFIG_PATH` environment variable.

```toml
[nachos]
name = "my-assistant"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"

[security]
mode = "standard"
```

## Core Settings

_Coming soon - detailed documentation of all core settings_

## LLM Configuration

_Coming soon - LLM provider configuration options_

### Supported Providers

- Anthropic (Claude)
- OpenAI (GPT)
- Ollama (Local)

See [LLM Proxy API](./api/llm-proxy-api.md) for implementation details.

## Channel Configuration

Channel configuration is explicit and secure by default. Unknown keys fail startup.

**Defaults:**

- Registry is config-driven (restart-to-reload)
- Mention-gating is enabled by default in group contexts
- DMs require explicit allowlist (pairing supported); DM config is optional
- Server/guild contexts require explicit allowlist + channel ID allowlist

### Minimal Per-Platform Fields

All platforms use a minimal, explicit structure:

```toml
[channels.discord]
token = "${DISCORD_BOT_TOKEN}"

[[channels.discord.servers]]
id = "1234567890"
channel_ids = ["111", "222"]
user_allowlist = ["user_a", "user_b"]
```

### Slack Modes

Slack supports Socket Mode and HTTP Events API. Socket Mode is recommended for local/dev.

```toml
[channels.slack]
mode = "socket" # or "http"
app_token = "${SLACK_APP_TOKEN}"
bot_token = "${SLACK_BOT_TOKEN}"

[[channels.slack.servers]]
id = "T123456"
channel_ids = ["C111", "C222"]
user_allowlist = ["U123", "U456"]
```

### WhatsApp Cloud API

WhatsApp uses the Cloud API with a webhook for inbound messages.

```toml
[channels.whatsapp]
token = "${WHATSAPP_TOKEN}"
phone_number_id = "${WHATSAPP_PHONE_NUMBER_ID}"
verify_token = "${WHATSAPP_VERIFY_TOKEN}"
app_secret = "${WHATSAPP_APP_SECRET}" # Optional: enables signature verification
webhook_path = "/whatsapp/webhook"
api_version = "v20.0"

[channels.whatsapp.dm]
user_allowlist = ["15551234567"]
```

Channels currently under development:
- Slack
- Discord
- Telegram
- WebChat
- WhatsApp

See [Channel Interface API](./api/channel-interface.md) for implementation details.

### DM Pairing (All Channels)

When `pairing = true` in a channel's DM config, users must pair before messages are accepted.

**How to pair (DM the bot):**

```
pair
```

If you set a pairing token, include it:

```
pair <token>
```

**Environment variables:**

- `NACHOS_PAIRING_TOKEN` (optional) - required token for pairing
- `RUNTIME_STATE_DIR` (optional) - directory used to persist pairing state (defaults to `./state`)

### Native Configuration Commands (Planned)

We plan to add native configuration commands for Slack and Discord (slash commands) to help admins
update allowlists, pairing, and status without editing `nachos.toml`. See
[Discord & Slack Native Configuration Commands Plan](./channel-configuration-commands.md) for the
current audit and implementation plan.

## Tool Configuration

_Coming soon - tool configuration options_

See [Tool Interface API](./api/tool-interface.md) for implementation details.

## Security Settings

Security configuration is critical. See [Security Guide](./security.md) for detailed information.

Key settings:

- `security.mode`: "strict", "standard", or "permissive"
- `security.dlp.action`: "block", "warn", "audit", "allow", or "redact"
- `security.approval.approver_allowlist`: optional list of users who can approve restricted actions
- Tool-specific permissions
- Network policies
- Audit logging

See [ADR-003: Security-First Design](./adr/003-security-first-design.md) for design rationale.

## Advanced Options

_Coming soon - advanced configuration options_

- Resource limits
- Custom networks
- Volume mounts
- Environment variables

---

**Note**: For immediate configuration help, see the example configuration in [nachos.toml.example](../nachos.toml.example).
