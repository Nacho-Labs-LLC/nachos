# Provider Switching Guide

How to configure Nachos to use different LLM providers — and how to set up
automatic fallback between them.

---

## Supported Providers

| Provider      | Config Value  | Auth                 | Local? |
| ------------- | ------------- | -------------------- | ------ |
| **Anthropic** | `"anthropic"` | `ANTHROPIC_API_KEY`  | No     |
| **OpenAI**    | `"openai"`    | `OPENAI_API_KEY`     | No     |
| **Ollama**    | `"ollama"`    | None (local)         | Yes    |
| **Bedrock**   | `"bedrock"`   | AWS credential chain | No     |
| **Gemini**    | `"gemini"`    | `GEMINI_API_KEY`     | No     |

## Quick Start: Switch Providers

Changing providers is a one-line config change. Edit `nachos.toml`:

```toml
[llm]
provider = "anthropic"              # Change this
model = "claude-sonnet-4-20250514"  # Change this
```

Set the matching API key in `.env`:

```bash
# .env — only the key for your chosen provider is required
ANTHROPIC_API_KEY="sk-ant-..."
# or
OPENAI_API_KEY="sk-..."
# or (Bedrock uses AWS credential chain, no key here)
```

Restart the stack:

```bash
nachos down && nachos up
```

That's it. No code changes. No container rebuilds.

---

## Provider Configs

### Anthropic (Default)

```toml
[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
max_tokens = 4096
temperature = 0.7
```

```bash
# .env
ANTHROPIC_API_KEY="sk-ant-api03-..."
```

**Models**: `claude-sonnet-4-20250514`, `claude-opus-4-20250514`,
`claude-haiku-4-5-20251001`

### OpenAI

```toml
[llm]
provider = "openai"
model = "gpt-4o"
max_tokens = 4096
temperature = 0.7
```

```bash
# .env
OPENAI_API_KEY="sk-..."
```

**Models**: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `o1`, `o1-mini`

### Ollama (Local)

Run models locally with no API key. Requires [Ollama](https://ollama.com)
installed on the host.

```toml
[llm]
provider = "ollama"
model = "llama3.2"
base_url = "http://host.docker.internal:11434"
max_tokens = 4096
temperature = 0.7
```

No `.env` changes needed.

**Note**: `host.docker.internal` connects from Docker containers to the host
machine where Ollama runs. On Linux without Docker Desktop, use the host's IP or
`172.17.0.1`.

**Models**: Any model pulled into Ollama — `llama3.2`, `mistral`, `codellama`,
`mixtral`, etc.

```bash
# Pull a model first
ollama pull llama3.2
```

### AWS Bedrock

Uses AWS credential chain — no API key in `.env`. See
[BEDROCK_SETUP.md](../../BEDROCK_SETUP.md) for detailed IAM and region setup.

```toml
[llm]
provider = "bedrock"
model = "anthropic.claude-3-5-sonnet-20241022-v2:0"
region = "us-east-1"
max_tokens = 4096
temperature = 0.7
```

```bash
# .env (or use IAM roles in production)
AWS_ACCESS_KEY_ID="AKIA..."
AWS_SECRET_ACCESS_KEY="..."
AWS_REGION="us-east-1"
```

**Models**: Bedrock model IDs include vendor prefix and version suffix:
`anthropic.claude-3-5-sonnet-20241022-v2:0`,
`anthropic.claude-3-haiku-20240307-v1:0`

### Gemini

```toml
[llm]
provider = "gemini"
model = "gemini-2.5-pro"
max_tokens = 4096
temperature = 0.7
```

```bash
# .env
GEMINI_API_KEY="AI..."
```

**Models**: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash`

---

## Fallback Chains

If your primary provider fails (rate limit, billing issue, outage), Nachos
automatically tries the next provider in the chain.

### Basic Fallback

```toml
[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
fallback_order = [
  "anthropic:claude-haiku-4-5-20251001",
  "openai:gpt-4o-mini",
]
```

The system tries in order:

1. `anthropic` / `claude-sonnet-4-20250514` (primary)
2. `anthropic` / `claude-haiku-4-5-20251001` (cheaper fallback)
3. `openai` / `gpt-4o-mini` (cross-provider fallback)

### Cross-Provider Fallback

Mix providers for maximum availability:

```toml
[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
fallback_order = [
  "openai:gpt-4o",
  "ollama:llama3.2",
]
```

If Anthropic is down, OpenAI takes over. If both cloud providers fail, Ollama
handles it locally.

### How Fallback Works

- **Rate limits** (`429`) and **billing errors** trigger fallback to the next
  provider
- **Auth errors** (`401`, `403`) fail immediately — no fallback, fix your key
- **Network errors** trigger fallback after retry with exponential backoff
- Each profile/provider tracks its own cooldown independently

---

## Multi-Profile Auth

Run multiple API keys for the same provider. Useful for:

- Rotating across subscription slots
- Separating billing by team
- Maximizing rate limit headroom

```toml
[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"

[[llm.profiles]]
name = "team-a"
provider = "anthropic"
api_key_env = "ANTHROPIC_API_KEY_TEAM_A"

[[llm.profiles]]
name = "team-b"
provider = "anthropic"
api_key_env = "ANTHROPIC_API_KEY_TEAM_B"

profile_order = ["team-a", "team-b"]
```

```bash
# .env
ANTHROPIC_API_KEY_TEAM_A="sk-ant-..."
ANTHROPIC_API_KEY_TEAM_B="sk-ant-..."
```

Profiles are tried in `profile_order`. When one hits a rate limit, it goes on
cooldown and the next profile takes over.

---

## Cooldown Configuration

Control how long a rate-limited profile stays out of rotation:

```toml
[llm.cooldowns]
initial_seconds = 60       # First cooldown: 1 minute
multiplier = 5             # Each subsequent: 5x longer
max_seconds = 3600         # Cap at 1 hour
billing_initial_hours = 5  # Billing errors: start at 5 hours
billing_max_hours = 24     # Cap at 24 hours
```

Cooldowns reset when the profile succeeds again.

---

## Timeout Configuration

All adapters default to 120 seconds. Override per-stack:

```toml
[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
timeout_ms = 60000  # 60 seconds
```

---

## Retry Configuration

Control retry behavior for transient failures:

```toml
[llm.retry]
attempts = 3              # Total attempts (including first)
min_delay_ms = 1000       # Initial backoff
max_delay_ms = 10000      # Max backoff
jitter = 0.2              # Randomize up to 20%
```

---

## Validation

Check your config before starting:

```bash
nachos config validate
# or
nachos validate
```

The validator checks:

- Provider is one of: `anthropic`, `openai`, `ollama`, `bedrock`, `custom`
- `fallback_order` entries are formatted as `"provider:model"`
- Temperature is between 0.0 and 2.0
- Required sections (`[nachos]`, `[llm]`, `[security]`) are present

---

## Common Patterns

### Development: Local-First with Cloud Fallback

Use Ollama locally, fall back to cloud when local models can't handle it:

```toml
[llm]
provider = "ollama"
model = "llama3.2"
base_url = "http://host.docker.internal:11434"
fallback_order = ["anthropic:claude-haiku-4-5-20251001"]
```

### Production: Cloud Primary with Redundancy

Maximum availability across providers:

```toml
[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
fallback_order = [
  "anthropic:claude-haiku-4-5-20251001",
  "openai:gpt-4o",
  "bedrock:anthropic.claude-3-5-sonnet-20241022-v2:0",
]

[[llm.profiles]]
name = "primary"
provider = "anthropic"
api_key_env = "ANTHROPIC_API_KEY"

[[llm.profiles]]
name = "backup"
provider = "anthropic"
api_key_env = "ANTHROPIC_API_KEY_BACKUP"

profile_order = ["primary", "backup"]
```

### Cost-Optimized: Cheap Primary, Smart Escalation

Start with the cheapest model, escalate only when needed (via fallback on
capability errors):

```toml
[llm]
provider = "anthropic"
model = "claude-haiku-4-5-20251001"
fallback_order = [
  "anthropic:claude-sonnet-4-20250514",
]
```

---

## Migrating Between Providers

### Anthropic to OpenAI

```diff
 [llm]
-provider = "anthropic"
-model = "claude-sonnet-4-20250514"
+provider = "openai"
+model = "gpt-4o"
```

```diff
 # .env
-ANTHROPIC_API_KEY="sk-ant-..."
+OPENAI_API_KEY="sk-..."
```

### Anthropic Direct to Bedrock

```diff
 [llm]
-provider = "anthropic"
-model = "claude-sonnet-4-20250514"
+provider = "bedrock"
+model = "anthropic.claude-3-5-sonnet-20241022-v2:0"
+region = "us-east-1"
```

See [BEDROCK_SETUP.md](../../BEDROCK_SETUP.md) for AWS credential setup.

### Cloud to Local (Ollama)

```diff
 [llm]
-provider = "anthropic"
-model = "claude-sonnet-4-20250514"
+provider = "ollama"
+model = "llama3.2"
+base_url = "http://host.docker.internal:11434"
```

---

## Troubleshooting

### "No available providers"

All providers in the fallback chain failed. Check:

1. API keys are set correctly in `.env`
2. At least one provider is reachable
3. No billing/quota issues across all providers

```bash
nachos logs gateway | grep -i "fallover\|provider\|error"
```

### "Unknown provider"

The `provider` value in `nachos.toml` isn't recognized. Valid values:
`anthropic`, `openai`, `ollama`, `bedrock`, `custom`.

### Fallback not triggering

Only rate limits and billing errors trigger fallback. Auth errors (`401`) fail
immediately — they indicate a config problem, not a transient issue.

### Ollama connection refused

- Verify Ollama is running: `ollama list`
- Check `base_url` — use `host.docker.internal` from Docker, or the host IP on
  Linux
- Ensure the model is pulled: `ollama pull llama3.2`
