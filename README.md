# 🧀 Nachos

**Your AI assistant, your way. Docker-native. Secure by default. Infinitely
customizable.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## What is Nachos?

Nachos is a modular AI assistant framework that runs entirely in Docker. Connect
it to your favorite messaging platforms, add the tools you need, and customize
everything—while maintaining strong security defaults.

Think of it like building a plate of nachos: start with a solid base, add your
toppings, and make it exactly the way you want.

```text
┌─────────────────────────────────────────────┐
│  Slack  │ Discord │ Telegram │   WebChat   │  ← Channels (pick yours)
├─────────────────────────────────────────────┤
│              🧀 Nachos Core                 │  ← Gateway + Message Bus
├─────────────────────────────────────────────┤
│  Browser │  Files  │  Code   │   Custom    │  ← Tools (add what you need)
├─────────────────────────────────────────────┤
│  Claude  │   GPT   │  Ollama │   Custom    │  ← LLM Providers
└─────────────────────────────────────────────┘
```

## Why Nachos?

| Feature           | Nachos                  | Traditional Assistants |
| ----------------- | ----------------------- | ---------------------- |
| **Deployment**    | Docker Compose          | npm install + daemon   |
| **Security**      | Strict by default       | Permissive by default  |
| **Modularity**    | Container per component | Monolithic             |
| **Network**       | Isolated by default     | Open by default        |
| **Configuration** | TOML + env vars         | Scattered JSON/YAML    |

## Quick Start

### For Development

```bash
# Clone the repository
git clone https://github.com/Nacho-Labs-LLC/nachos.git
cd nachos

# Copy environment variables
cp .env.example .env
# Edit .env and add your LLM API key (ANTHROPIC_API_KEY, ANTHROPIC_SETUP_TOKEN, or OPENAI_API_KEY)

# Start the development stack
docker compose -f docker-compose.dev.yml up

# In another terminal, view logs
docker compose -f docker-compose.dev.yml logs -f

# Run tests
./docker/test-infrastructure.sh
```

### For End Users

```bash
# Install the CLI (global)
pnpm add -g @nachos/cli

# Initialize your stack
nachos init

# Start it up
nachos up

# Open the web chat
open http://localhost:8080
```

Prereqs: Docker Desktop (or Docker Engine) must be running.

## The Nacho Philosophy

Every great plate of nachos has layers:

- **🔲 Chips (Base)**: Gateway + Message Bus — the foundation
- **🧀 Cheese (Binding)**: Connects all your toppings together
- **🥩 Protein (Substance)**: Your LLM provider (Claude, GPT, Ollama)
- **🫑 Toppings (Modules)**: Channels and tools you choose
- **🌶️ Cheese (Protection)**: Security policies that keep you safe
- **🍽️ The Plate (Container)**: Docker Compose serves it all

## Configuration

TOML + env vars. That's it.

```toml
# nachos.toml

[nachos]
name = "my-assistant"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"

[channels.slack]
mode = "socket"
app_token = "${SLACK_APP_TOKEN}"
bot_token = "${SLACK_BOT_TOKEN}"

[[channels.slack.servers]]
id = "T123456"
channel_ids = ["C111"]
user_allowlist = ["U123"]

[channels.discord]
token = "${DISCORD_BOT_TOKEN}"

[[channels.discord.servers]]
id = "1234567890"
channel_ids = ["111"]
user_allowlist = ["user_a"]

[tools.browser]
enabled = true

[tools.filesystem]
enabled = true
paths = ["./workspace"]

[security]
mode = "standard"
```

### Env-first setup

If you prefer configuring via environment variables, keep `nachos.toml` minimal and put the
values in `.env`. The loader will read `.env` and then apply env overrides on startup.

```toml
# nachos.toml (minimal)
[nachos]
name = "my-assistant"
version = "1.0"

[llm]
provider = "anthropic"
model = "claude"

[security]
mode = "standard"
```

```bash
# .env
LLM_MODEL="claude-sonnet-4-20250514"
SECURITY_MODE="standard"
TOOL_BROWSER_ENABLED="true"
TOOL_FILESYSTEM_ENABLED="true"
```

### Claude setup-token (subscription)

If you have a Claude Pro/Max subscription, generate a setup-token via the Claude Code CLI:

```bash
claude setup-token
```

Then configure Nachos to use it:

```bash
nachos auth setup-token
```

This command creates/updates an Anthropic profile in `nachos.toml` and can optionally write the
token to your `.env` file.

## Security Modes

Choose your comfort level:

| Mode              | Description                                                         |
| ----------------- | ------------------------------------------------------------------- |
| **🔒 Strict**     | Everything disabled by default. Allowlist only. Full audit logging. |
| **⚖️ Standard**   | Common tools enabled. Pairing-based DMs. Balanced security.         |
| **🔓 Permissive** | Full access. Requires explicit opt-in. Use with caution.            |

```toml
[security]
mode = "strict"  # Start here, relax as needed
```

## Adding Modules

Use the CLI to add module stubs, then enable them in `nachos.toml` and restart:

```bash
nachos add channel slack
nachos add tool browser
nachos restart
```

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                      Docker Compose                           │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                Gateway (with embedded security)          │ │
│  │    DLP │ Rate Limits │ Policies │ Audit │ Sessions      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                            │                                  │
│  ┌─────────────────────────▼─────────────────────────────┐   │
│  │                    Bus (NATS)                          │   │
│  │              Message passing + state                   │   │
│  └────────────────────────────────────────────────────────┘  │
│       │            │              │              │            │
│  ┌────▼────┐  ┌────▼────┐  ┌─────▼─────┐  ┌────▼────┐       │
│  │LLM Proxy│  │ Channels  │  │  Tools    │  │ Redis   │      │
│  │         │  │           │  │           │  │(optional)│      │
│  │ Claude  │  │  Slack    │  │ Browser   │  │         │      │
│  │ GPT     │  │  Discord  │  │ Files     │  │Scaling  │      │
│  │ Ollama  │  │  Telegram │  │ Code      │  │Support  │      │
│  └─────────┘  └───────────┘  └───────────┘  └─────────┘     │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              Internal Network (isolated)                │ │
│  └─────────────────────────────────────────────────────────┘ │
│                            │                                  │
│                   ┌────────▼────────┐                        │
│                   │  Egress Network │                        │
│                   │ (controlled exit)│                        │
│                   └─────────────────┘                        │
└──────────────────────────────────────────────────────────────┘
```

## CLI Reference

```bash
nachos init          # Initialize new project
nachos up            # Start all containers
nachos down          # Stop all containers
nachos logs          # View logs
nachos status        # Show status
nachos doctor        # Health check

nachos restart       # Restart the stack
nachos validate      # Run config + policy + doctor checks
nachos config validate  # Validate nachos.toml
nachos policy validate  # Validate policies/

nachos add --interactive
nachos add channel <name>
nachos add tool <name>
nachos open <service>   # Open admin/webchat/gateway/nats/docs
```

For now, use Docker Compose directly:

```bash
docker compose -f docker-compose.dev.yml up
docker compose -f docker-compose.dev.yml down
docker compose -f docker-compose.dev.yml logs -f
```

## Project Structure

### Project Structure for End Users

```text
my-nachos/
├── nachos.toml           # Your configuration
├── docker-compose.yml    # Generated by CLI
├── policies/             # Security policies
│   └── custom.yaml       # Your policy overrides
├── workspace/            # Filesystem tool access
├── skills/               # Custom skills
└── .env                  # Secrets (gitignored)
```

### For Developers

```text
nachos/
├── packages/
│   ├── core/             # Core services
│   │   ├── gateway/      # Session management
│   │   ├── bus/          # NATS message bus
│   │   ├── llm-proxy/    # LLM provider abstraction
│   ├── channels/         # Channel adapters
│   ├── tools/            # Tool containers
│   └── shared/           # Shared utilities
├── docker/               # Docker infrastructure
│   ├── Dockerfile.base   # Base template
│   ├── nats/             # NATS config
│   └── README.md         # Docker docs
├── docker-compose.dev.yml # Development stack
└── .env.example          # Environment template
```

See [../../PROJECT_ROADMAP.md](../../PROJECT_ROADMAP.md) for longer-term plans and [docs/adr/](docs/adr/) for architectural decisions.

## Documentation

- [Getting Started](docs/getting-started.md)
- [Configuration Reference](docs/configuration.md)
- [Security Guide](docs/security.md)
- [Creating Custom Modules](docs/custom-modules.md)
- [Architecture Deep Dive](docs/architecture.md)

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License. See [LICENSE](LICENSE) for details.

---

Built with 🧀 by the Nachos community.
