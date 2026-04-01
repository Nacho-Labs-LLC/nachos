# Architecture Deep Dive

This document describes how Nachos is structured internally. For high-level
concepts, see the [README](../README.md). For specific decisions and their
rationale, see the [ADRs](adr/).

---

## Overview

Nachos is a monorepo of Docker-native packages that together form a self-hosted
AI assistant platform. The core concern is routing: messages from channels →
gateway → LLM → tools → back to channel.

```
┌──────────────────────────────────────────────────────┐
│               Channels (Discord, Slack, etc.)        │
│   packages/channels/{discord,slack,telegram,...}     │
└────────────────────────┬─────────────────────────────┘
                         │  Events (via Message Bus)
                         ▼
┌──────────────────────────────────────────────────────┐
│              Message Bus                             │
│              packages/bus                            │
└────────────────────────┬─────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────┐
│              Gateway (Core)                          │
│              packages/core/gateway                   │
│                                                      │
│   ┌──────────────────────────────────────────────┐  │
│   │  Session Manager  │  Tool Dispatcher         │  │
│   │  Prompt Assembly  │  Config / Security       │  │
│   └──────────────────────────────────────────────┘  │
└────────┬─────────────────────────┬───────────────────┘
         │                         │
         ▼                         ▼
┌─────────────────┐     ┌──────────────────────────────┐
│  LLM Proxy      │     │  Tools                       │
│  packages/      │     │  packages/tools/             │
│  core/llm-proxy │     │  {shell, web-fetch,          │
│                 │     │   filesystem, code-runner}   │
│  Claude / GPT   │     └──────────────────────────────┘
│  Bedrock / Ollama│
└─────────────────┘
```

---

## Package Map

| Package             | Path                         | Role                                                                       |
| ------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| `gateway`           | `packages/core/gateway`      | Central orchestrator. Routes messages, manages sessions, dispatches tools. |
| `bus`               | `packages/bus`               | Internal message bus. Channels and gateway communicate via events.         |
| `llm-proxy`         | `packages/core/llm-proxy`    | Adapter layer for LLM providers (Anthropic, OpenAI, Bedrock, Ollama).      |
| `admin`             | `packages/admin`             | Vue.js admin UI. Config editor, session viewer, log tailing.               |
| `cli`               | `packages/cli`               | `nachos` CLI. `nachos init`, `nachos up`, `nachos config`.                 |
| `shared`            | `packages/shared`            | Shared types, config schema, validation, utilities.                        |
| `channels/discord`  | `packages/channels/discord`  | Discord adapter.                                                           |
| `channels/slack`    | `packages/channels/slack`    | Slack adapter.                                                             |
| `channels/telegram` | `packages/channels/telegram` | Telegram adapter.                                                          |
| `channels/whatsapp` | `packages/channels/whatsapp` | WhatsApp adapter.                                                          |
| `channels/matrix`   | `packages/channels/matrix`   | Matrix/Element adapter.                                                    |
| `tools/filesystem`  | `packages/tools/filesystem`  | File read/write tool.                                                      |
| `tools/web-fetch`   | `packages/tools/web-fetch`   | HTTP fetch / web scraping tool.                                            |
| `tools/code-runner` | `packages/tools/code-runner` | Sandboxed code execution.                                                  |

---

## Gateway

The gateway is the brain. On message receipt:

1. **Session lookup / creation** — each conversation gets a persistent session
2. **Prompt assembly** — system prompt + tool definitions + message history
   assembled (see [BOOTSTRAP_PROMPT_ASSEMBLY.md](BOOTSTRAP_PROMPT_ASSEMBLY.md))
3. **LLM dispatch** — request sent to configured LLM provider via llm-proxy
4. **Tool handling** — if the LLM requests a tool call, gateway dispatches,
   collects result, re-enters LLM loop
5. **Response delivery** — final response delivered back through the originating
   channel

### Session Management

Sessions are stored in StateStorage (SQLite by default, Postgres supported).
Each session holds:

- Conversation history (messages)
- Session metadata (channel, user, status)
- Configuration overrides

See `packages/core/gateway/src/session/` for implementation.

### Security Enforcement

Security mode is applied at the gateway layer — before any tool is dispatched.
See [Security Guide](security.md) and
[ADR-002](adr/002-shell-tool-security-model.md).

---

## LLM Proxy

The LLM proxy normalizes differences between providers into a single interface.
All providers implement:

```typescript
interface LLMProvider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream(request: CompletionRequest): AsyncIterable<CompletionChunk>;
}
```

Provider selection is by `llm.provider` in config. See
[ADR-001](adr/001-bedrock-adapter-type.md) for the Bedrock adapter decision.

---

## Message Bus

The bus decouples channels from the gateway. Channels publish `message.received`
events; the gateway subscribes and processes them. Responses are published back
as `message.send` events.

This enables:

- Hot-pluggable channels (add/remove without restarting gateway)
- Future horizontal scaling (multiple gateway replicas)

---

## Skills

Skills are Markdown documents (`SKILL.md`) that provide the LLM with specialized
knowledge for external tools and APIs. They are injected into the system prompt
at startup.

See [ADR-003](adr/003-skill-structure.md) for the skill format decision, and
[SKILL_TOOLS.md](SKILL_TOOLS.md) for the catalog of available skills.

---

## Configuration

All configuration is in `nachos.toml`. Types are defined in
`packages/shared/config/src/schema.ts` and validated at startup. See
[Configuration Reference](configuration.md).

---

## Further Reading

- [Bootstrap Prompt Assembly](BOOTSTRAP_PROMPT_ASSEMBLY.md) — how the system
  prompt is constructed
- [Subagent Orchestration](SUBAGENT_ORCHESTRATION.md) — how Nachos spawns and
  manages sub-agents
- [ADRs](adr/) — all architectural decisions with rationale
- [Guides](guides/) — deep dives on specific subsystems
