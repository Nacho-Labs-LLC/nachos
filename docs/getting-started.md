# Getting Started with Nachos

Welcome to Nachos — your AI assistant, your way. This guide walks you from zero
to a running instance in minutes.

---

## Prerequisites

- [Docker Desktop](https://docs.docker.com/get-docker/) (Mac/Windows) or Docker
  Engine + Compose plugin (Linux)
- An LLM API key (Anthropic, OpenAI, or a local Ollama instance)

---

## 1. Quickstart (Recommended)

```bash
# Clone the repository
git clone https://github.com/Nacho-Labs-LLC/nachos.git
cd nachos

# Copy environment template and add your API key
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY (or OPENAI_API_KEY for OpenAI)

# Start the stack
docker compose up
```

Open [http://localhost:8080](http://localhost:8080) to see the web chat
interface.

---

## 2. Configuration

All configuration lives in `nachos.toml`. A minimal config:

```toml
[nachos]
name = "Nachos"

[llm]
provider = "anthropic"
model = "claude-3-5-sonnet-latest"

[security]
mode = "standard"
```

See the [Configuration Reference](configuration.md) for all options.

---

## 3. Add a Channel

Channels connect Nachos to messaging platforms. To add Discord:

```toml
[[channels]]
type = "discord"
token = "${DISCORD_TOKEN}"
```

Set `DISCORD_TOKEN` in your `.env`. See [Skill Tools](SKILL_TOOLS.md) for
available channel skills.

---

## 4. Add Tools

Tools let Nachos take actions (browse the web, run shell commands, read files).
Example:

```toml
[[tools]]
type = "shell"
# Requires security.mode = "permissive"
```

See [Creating Custom Modules](custom-modules.md) for building your own tools.

---

## 5. Development Setup

```bash
# Start with hot-reload
docker compose -f docker-compose.dev.yml up

# Watch logs
docker compose -f docker-compose.dev.yml logs -f gateway

# Run the test suite
./docker/test-infrastructure.sh
```

---

## 6. Next Steps

- [Configuration Reference](configuration.md) — complete option reference
- [Security Guide](security.md) — understand security modes and best practices
- [Architecture Deep Dive](architecture.md) — how Nachos is structured
  internally
- [Creating Custom Modules](custom-modules.md) — extend Nachos with your own
  channels and tools
- [ADRs](adr/) — architectural decisions and their rationale

---

## Troubleshooting

**Container won't start:** Check that your `.env` has a valid API key and
`nachos.toml` is present. Run `docker compose logs gateway` for details.

**Web chat not loading:** Verify port 8080 is free. If using a custom port,
check the `webui.port` config option.

**LLM errors / 401 Unauthorized:** Your API key is invalid or missing.
Double-check `.env` and restart the stack.

For more help, see the [full troubleshooting guide](TROUBLESHOOTING.md) (coming
soon) or open a GitHub issue.
