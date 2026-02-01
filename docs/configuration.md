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

_Coming soon - channel configuration for each platform_

Channels currently under development:
- Slack
- Discord
- Telegram
- WebChat

See [Channel Interface API](./api/channel-interface.md) for implementation details.

## Tool Configuration

_Coming soon - tool configuration options_

See [Tool Interface API](./api/tool-interface.md) for implementation details.

## Security Settings

Security configuration is critical. See [Security Guide](./security.md) for detailed information.

Key settings:

- `security.mode`: "strict", "standard", or "permissive"
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
