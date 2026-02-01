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
# Edit .env and add your LLM API key (ANTHROPIC_API_KEY or OPENAI_API_KEY)

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
enabled = true

[channels.discord]
enabled = true
dm_policy = "allowlist"

[tools.browser]
enabled = true

[tools.filesystem]
enabled = true
paths = ["./workspace"]

[security]
mode = "standard"
```

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

```bash
# See what's available
nachos search channels
nachos search tools

# Add what you need
nachos add channel telegram
nachos add tool code-runner

# Remove what you don't
nachos remove channel slack
```

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Docker Compose                           │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                   Salsa (Policy)                        │ │
│  │    DLP │ Rate Limits │ Allowlists │ Audit Logging      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                            │                                  │
│  ┌─────────────────────────▼─────────────────────────────┐   │
│  │                    Bus (NATS)                          │   │
│  │              Message passing + state                   │   │
│  └────────────────────────────────────────────────────────┘  │
│       │            │              │              │            │
│  ┌────▼────┐  ┌────▼────┐  ┌─────▼─────┐  ┌────▼────┐       │
│  │ Gateway │  │LLM Proxy│  │ Channels  │  │  Tools  │       │
│  │         │  │         │  │           │  │         │       │
│  │Sessions │  │ Claude  │  │  Slack    │  │ Browser │       │
│  │Routing  │  │ GPT     │  │  Discord  │  │ Files   │       │
│  │State    │  │ Ollama  │  │  Telegram │  │ Code    │       │
│  └─────────┘  └─────────┘  └───────────┘  └─────────┘       │
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
nachos restart       # Restart the stack
nachos logs          # View aggregated logs
nachos status        # Show running components
nachos doctor        # Health check & diagnostics

nachos add <type> <name>      # Add a channel or tool
nachos remove <type> <name>   # Remove a channel or tool
nachos search <type>          # Browse available modules

nachos chat          # Interactive CLI chat
nachos config        # Edit configuration

nachos create channel <name>  # Scaffold custom channel
nachos create tool <name>     # Scaffold custom tool
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
│   │   └── salsa/        # Policy engine
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

## Development Status

**Phase 0: Foundation Setup** ✅ Complete
- [x] Repository structure
- [x] Docker infrastructure with hot-reload
- [x] Network isolation (internal + egress)
- [x] Core service scaffolding

**Phase 1: Core Infrastructure** 🚧 In Progress
- [ ] Gateway implementation
- [ ] NATS message handling
- [ ] LLM proxy with provider abstraction
- [ ] Policy engine (Salsa)

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
