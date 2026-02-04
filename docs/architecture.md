# Nachos Architecture

This document provides a comprehensive overview of the Nachos architecture.

## System Overview

Nachos is a Docker-native AI assistant framework built on four principles:

1. **Container-per-component**: Every module runs in isolation
2. **Secure by default**: Deny-all, then explicitly grant
3. **Single config file**: One `nachos.toml` rules everything
4. **Composable**: Add/remove toppings without rebuilding

## High-Level Architecture

```mermaid
flowchart TB
    subgraph External["External World"]
        User["👤 User"]
        LLM["🤖 LLM APIs"]
        ExtAPI["🌐 External APIs"]
    end

    subgraph DockerCompose["🍽️ Docker Compose (The Plate)"]
        subgraph Core["🔲 Core (Chips + Salsa)"]
            subgraph GatewayBox["Gateway"]
                Router["Router"]
                SessionMgr["Session Manager"]
                subgraph SalsaEmbed["🌶️ Salsa (embedded)"]
                    Policy["Policy Engine"]
                    DLP["DLP Scanner"]
                    RateLimit["Rate Limiter"]
                    Audit["Audit Logger"]
                end
            end
            Bus["Message Bus<br/>(NATS)"]
            Redis["Redis<br/>(shared state)"]
        end

        subgraph Protein["🥩 Protein"]
            LLMProxy["LLM Proxy"]
        end

        subgraph Toppings["🫑 Toppings"]
            subgraph Channels["Channels"]
                Slack["Slack"]
                Discord["Discord"]
                Telegram["Telegram"]
                WebChat["WebChat"]
                WhatsApp["WhatsApp"]
            end
            subgraph Tools["Tools"]
                Browser["Browser"]
                FileSystem["Filesystem"]
                CodeRunner["Code Runner"]
            end
        end

        subgraph Networks["Networks"]
            Internal["nachos-internal<br/>(isolated)"]
            Egress["nachos-egress<br/>(controlled)"]
        end
    end

    User <--> Channels
    Channels <--> Bus
    Bus <--> GatewayBox
    GatewayBox <--> Redis
    GatewayBox <--> LLMProxy
    GatewayBox <--> Tools
    LLMProxy <--> LLM
    Browser <--> ExtAPI

    Core --- Internal
    Toppings --- Internal
    LLMProxy --- Egress
    Browser --- Egress
```

> **Note**: Salsa (the security layer) is embedded within Gateway for performance.
> See [ADR-004](./adr/004-embedded-salsa-shardable-gateway.md) for rationale.

## Component Details

### Core Components (The Chips)

These are always present in any Nachos deployment.

#### Gateway

The central orchestrator that:

- Manages user sessions
- Routes messages between components
- Maintains conversation state
- Coordinates tool execution

```mermaid
flowchart LR
    subgraph Gateway
        Router["Router"]
        SessionMgr["Session Manager"]
        State["State Store"]
        ToolCoord["Tool Coordinator"]
    end

    Bus["Message Bus"] <--> Router
    Router <--> SessionMgr
    SessionMgr <--> State
    Router <--> ToolCoord
```

#### Message Bus (NATS)

Lightweight message passing that:

- Decouples components
- Enables pub/sub patterns
- Handles request/reply
- Provides message persistence

**Topic Structure:**

```text
nachos.channel.{channel_name}.inbound    # Messages from users
nachos.channel.{channel_name}.outbound   # Messages to users
nachos.tool.{tool_name}.request          # Tool invocations
nachos.tool.{tool_name}.response         # Tool results
nachos.llm.request                       # LLM completions
nachos.llm.response                      # LLM responses
nachos.policy.check                      # Policy validation
nachos.audit.log                         # Audit events
```

### Security Layer (Salsa) - Embedded in Gateway

Salsa is embedded within Gateway for minimal latency (~0.1ms vs ~2-5ms for network calls).
All requests pass through Salsa before execution. See [ADR-004](./adr/004-embedded-salsa-shardable-gateway.md).

```mermaid
flowchart TD
    Request["Incoming Request"] --> DLP
    DLP["DLP Scanner"] -->|Clean| RateLimit
    DLP -->|Sensitive| Block["Block + Alert"]
    RateLimit["Rate Limiter"] -->|Under Limit| Policy
    RateLimit -->|Over Limit| Throttle["Throttle"]
    Policy["Policy Engine"] -->|Allowed| Execute["Execute"]
    Policy -->|Denied| Deny["Deny + Log"]
    Execute --> Audit["Audit Logger"]
    Block --> Audit
    Deny --> Audit
```

#### Policy Engine

Evaluates requests against rules:

```yaml
# Example policy rule
- name: 'tool-filesystem-write'
  match:
    tool: 'filesystem'
    action: 'write'
  conditions:
    - security_mode: ['standard', 'permissive']
    - path_allowed: true
  effect: 'allow'
```

### LLM Proxy (Protein)

Abstracts LLM provider differences:

```mermaid
flowchart LR
    Gateway["Gateway"] --> Proxy["LLM Proxy"]
    Proxy --> Anthropic["Anthropic API"]
    Proxy --> OpenAI["OpenAI API"]
    Proxy --> Ollama["Ollama (local)"]

    Proxy --> Cache["Response Cache"]
    Proxy --> Fallback["Fallback Logic"]
```

**Responsibilities:**

- Unified API across providers
- Automatic retry with exponential backoff
- Fallback to secondary model
- Token counting and limits
- Response streaming

### Channels (Toppings)

Each channel is a standalone container:

```mermaid
flowchart TD
    subgraph SlackChannel["Slack Channel Container"]
        Adapter["Slack Adapter<br/>(Bolt SDK)"]
        Normalizer["Message Normalizer"]
        Formatter["Response Formatter"]
    end

    SlackAPI["Slack API"] <--> Adapter
    Adapter <--> Normalizer
    Normalizer <--> Bus["Message Bus"]
    Bus <--> Formatter
    Formatter <--> Adapter
```

**Channel Contract:**

- Receive platform-specific messages
- Normalize to common format
- Publish to bus
- Subscribe to responses
- Format for platform delivery

**Channel Registry + Policy Defaults:**

- Registry is config-driven and loaded at startup (restart-to-reload)
- Strict config validation: unknown keys fail startup
- Group contexts require mention by default (mention-gating on)
- DMs require explicit allowlist; pairing supported when enabled
- Server/guild contexts require explicit allowlist + channel ID allowlist

### Tools (Toppings)

Tools execute capabilities in isolation:

```mermaid
flowchart TD
    subgraph ToolContainer["Tool Container"]
        Interface["Tool Interface"]
        Executor["Executor"]
        Sandbox["Sandbox/Limits"]
    end

    Bus["Message Bus"] --> Interface
    Interface --> Sandbox
    Sandbox --> Executor
    Executor --> Result["Result"]
    Result --> Interface
    Interface --> Bus
```

**Tool Security Tiers:**

| Tier           | Examples      | Sandbox | Network |
| -------------- | ------------- | ------- | ------- |
| 0 - Safe       | Read calendar | No      | None    |
| 1 - Standard   | Browse web    | Yes     | Limited |
| 2 - Elevated   | Write files   | Yes     | None    |
| 3 - Restricted | Execute code  | Strict  | None    |
| 4 - Dangerous  | Shell access  | N/A     | Blocked |

## Network Architecture

```mermaid
flowchart TB
    subgraph Internet["Internet"]
        LLM["LLM APIs"]
        ChannelAPIs["Channel APIs<br/>(Slack, Discord, etc.)"]
        WebAPIs["Web APIs"]
    end

    subgraph EgressNet["nachos-egress"]
        LLMProxy["LLM Proxy"]
        ChannelContainers["Channel Containers"]
        BrowserTool["Browser Tool"]
    end

    subgraph InternalNet["nachos-internal (isolated)"]
        Gateway["Gateway"]
        Bus["Bus"]
        Salsa["Salsa"]
        SafeTools["Safe Tools"]
    end

    LLMProxy <--> LLM
    ChannelContainers <--> ChannelAPIs
    BrowserTool <--> WebAPIs

    LLMProxy --- InternalNet
    ChannelContainers --- InternalNet
    BrowserTool --- InternalNet
```

**Key Points:**

- Internal network has NO external access
- Egress network is explicitly granted
- Each container only joins necessary networks
- Manifest declares network requirements

## Message Flow

### User Message → Response

```mermaid
sequenceDiagram
    participant U as User
    participant C as Channel
    participant B as Bus
    participant S as Salsa
    participant G as Gateway
    participant L as LLM Proxy
    participant T as Tool

    U->>C: Send message
    C->>B: Publish (normalized)
    B->>S: Policy check
    S-->>B: Approved
    B->>G: Route to gateway
    G->>G: Load session
    G->>B: LLM request
    B->>L: Forward
    L->>L: Call LLM API
    L-->>B: Response (with tool call)
    B-->>G: Forward
    G->>B: Tool request
    B->>S: Policy check
    S-->>B: Approved
    B->>T: Execute
    T-->>B: Result
    B-->>G: Forward
    G->>B: Final LLM request
    B->>L: Forward
    L-->>B: Final response
    B-->>G: Forward
    G->>B: Outbound message
    B->>C: Deliver
    C->>U: Send response
```

## Data Flow

### State Management

```mermaid
flowchart LR
    subgraph Ephemeral["Ephemeral (Container Memory)"]
        SessionCache["Session Cache"]
    end

    subgraph SharedState["Shared State (Redis)"]
        RateLimits["Rate Limit Counters"]
        SessionMap["Session Routing Map"]
        SessionSync["Session Sync Queue"]
    end

    subgraph Persistent["Persistent (Volumes)"]
        StateDB["State DB<br/>(SQLite per instance)"]
        AuditLogs["Audit Logs<br/>(modular providers)"]
        Credentials["Credentials<br/>(encrypted)"]
    end

    Gateway --> SessionCache
    SessionCache <--> StateDB
    Gateway --> RateLimits
    Gateway --> SessionMap
    Gateway --> AuditLogs
    LLMProxy --> Credentials
```

**Horizontal Scaling**: Rate limits and session routing use Redis for consistency
across Gateway instances. See [ADR-004](./adr/004-embedded-salsa-shardable-gateway.md).

**Audit Providers**: Audit logging supports multiple backends (SQLite, file, webhook, custom).
See [ADR-005](./adr/005-modular-audit-providers.md).

## Module System

### Manifest Structure

Every module declares its requirements:

```json
{
  "name": "nachos-channel-slack",
  "version": "1.0.0",
  "type": "channel",

  "requires": {
    "gateway": "^1.0",
    "bus": "^1.0"
  },

  "capabilities": {
    "network": {
      "egress": ["slack.com", "api.slack.com", "files.slack.com"]
    },
    "secrets": ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"],
    "volumes": []
  },

  "provides": {
    "channel": "slack",
    "features": ["dm", "channels", "threads", "reactions", "files"]
  },

  "container": {
    "image": "nachoclaw/channel-slack",
    "resources": {
      "memory": "256MB",
      "cpus": 0.25
    }
  }
}
```

### Compose Generation

The CLI reads `nachos.toml` + manifests to generate `docker-compose.yml`:

```mermaid
flowchart LR
    Config["nachos.toml"] --> CLI["Nachos CLI"]
    Manifests["Module Manifests"] --> CLI
    CLI --> Compose["docker-compose.yml"]
    CLI --> Env[".env validation"]
```

## Deployment Patterns

### Minimal (Development)

```yaml
services:
  gateway: ...
  bus: ...
  llm-proxy: ...
  webchat: ...
```

### Standard (Personal Use)

```yaml
services:
  gateway: ...
  bus: ...
  salsa: ...
  llm-proxy: ...
  webchat: ...
  slack: ...
  filesystem: ...
  browser: ...
```

### Full (Power User)

All available channels and tools enabled.

## Extension Points

### Custom Channels

1. Implement channel interface
2. Create manifest
3. Build container
4. Register with CLI

### Custom Tools

1. Implement tool interface
2. Define schema
3. Assign security tier
4. Create manifest
5. Build container

### Custom Policies

1. Create policy YAML
2. Place in `policies/`
3. Policies hot-reload

## Performance Considerations

- **Message Bus**: NATS handles 10M+ msg/sec
- **Gateway**: Stateless, horizontally scalable
- **LLM Proxy**: Connection pooling, streaming
- **Tools**: Parallel execution where safe
- **Containers**: Resource limits prevent runaway

## Security Summary

| Layer      | Protection                            |
| ---------- | ------------------------------------- |
| Container  | Non-root, read-only, dropped caps     |
| Network    | Internal isolation, controlled egress |
| Policy     | Deny-default, explicit allow          |
| DLP        | Pattern matching, configurable action |
| Audit      | Full logging, tamper-evident          |
| Rate Limit | Per-user, per-operation limits        |
