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

```
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
| **Configuration** | Single TOML file        | Scattered JSON/YAML    |

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

### For End Users (coming soon)

```bash
# Install the CLI
curl -fsSL https://nachos.dev/install.sh | sh

# Initialize your stack
nachos init

# Start it up
nachos up

# Open the web chat
open http://localhost:8080
```

## The Nacho Philosophy

Every great plate of nachos has layers:

- **🔲 Chips (Base)**: Gateway + Message Bus — the foundation
- **🧀 Cheese (Binding)**: Connects all your toppings together
- **🥩 Protein (Substance)**: Your LLM provider (Claude, GPT, Ollama)
- **🫑 Toppings (Modules)**: Channels and tools you choose
- **🌶️ Salsa (Protection)**: Security policies that keep you safe
- **🍽️ The Plate (Container)**: Docker Compose serves it all

## Configuration

One file. That's it.

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

**Coming soon**: Module registry and CLI commands.

For now, modules are configured in `nachos.toml` (restart required).

## Architecture

```
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

## CLI Reference (Coming in Phase 5)

## CLI Reference (Coming in Phase 5)

**Planned commands** (not yet implemented):

```bash
nachos init          # Initialize new project
nachos up            # Start all containers
nachos down          # Stop all containers
nachos logs          # View logs
nachos status        # Show status
nachos doctor        # Health check

nachos config        # Edit configuration
```

For now, use Docker Compose directly:

```bash
docker compose -f docker-compose.dev.yml up
docker compose -f docker-compose.dev.yml down
docker compose -f docker-compose.dev.yml logs -f
```

## Project Structure

### For End Users

```
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

```
nachos/
├── packages/
│   ├── core/             # Core services
│   │   ├── gateway/      # Session management
│   │   ├── bus/          # NATS message bus
│   │   ├── llm-proxy/    # LLM provider abstraction
│   ├── channels/         # Channel adapters (coming soon)
│   ├── tools/            # Tool containers (coming soon)
│   └── shared/           # Shared utilities
├── docker/               # Docker infrastructure
│   ├── Dockerfile.base   # Base template
│   ├── nats/             # NATS config
│   └── README.md         # Docker docs
├── docker-compose.dev.yml # Development stack
└── .env.example          # Environment template
```
Current Phase**: Phase 7 - Additional Channels (🚧 In Progress)

**Completed**:
- ✅ Phase 0: Foundation Setup
- ✅ Phase 1: Core Infrastructure (Gateway, Bus, Message Flow)
- ✅ Phase 2: Security Layer (Embedded in Gateway: DLP, Rate Limiting, Policy Engine, Audit)
- ✅ Phase 3: LLM Integration (Multi-provider proxy: Claude, GPT, Ollama)
- ✅ Phase 4: First Channels (Slack + Discord with attachments, mention gating, pairing)
- ✅ Phase 6: Tools (Browser, Filesystem, Code Runner)

**In Progress**:
- 🚧 Phase 5: CLI Tooling
- 🚧 Phase 7: Additional Channels (Telegram, WhatsApp)

**Next Steps**:
- Phase 8: Polish & Launch
- Phase 9: Registry & Addons

See [../../PROJECT_ROADMAP.md](../../PROJECT_ROADMAP.md) for full details and [docs/adr/](docs/adr/) for architectural decisions.
**Phase 2+**: Coming soon...

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

**Built with 🧀 by the Nachos community**
