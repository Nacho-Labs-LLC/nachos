# Nachos Technical Specification

## Overview

This document provides detailed technical specifications for implementing Nachos
core components. It serves as the authoritative reference for development.

---

## 1. Message Schemas

All inter-component communication uses JSON messages over NATS. Schemas defined
with TypeBox for runtime validation.

### 1.1 Base Message Envelope

```typescript
import { Type, Static } from '@sinclair/typebox';

const MessageEnvelope = Type.Object({
  id: Type.String({ format: 'uuid' }),
  timestamp: Type.String({ format: 'date-time' }),
  source: Type.String(), // Component that sent the message
  type: Type.String(), // Message type identifier
  correlationId: Type.Optional(Type.String()), // For request/reply
  payload: Type.Unknown(), // Message-specific payload
});

type MessageEnvelope = Static<typeof MessageEnvelope>;
```

### 1.2 Channel Inbound Message

Messages from users, normalized from platform-specific formats.

```typescript
const ChannelInboundMessage = Type.Object({
  channel: Type.String(), // "slack", "discord", etc.
  channelMessageId: Type.String(), // Platform's message ID
  sessionId: Type.Optional(Type.String()), // Existing session if known

  sender: Type.Object({
    id: Type.String(), // Platform user ID
    name: Type.Optional(Type.String()),
    isAllowed: Type.Boolean(), // Passed DM policy check
  }),

  conversation: Type.Object({
    id: Type.String(), // Platform conversation ID
    type: Type.Union([
      Type.Literal('dm'),
      Type.Literal('channel'),
      Type.Literal('thread'),
    ]),
  }),

  content: Type.Object({
    text: Type.Optional(Type.String()),
    attachments: Type.Optional(
      Type.Array(
        Type.Object({
          type: Type.String(), // "image", "file", "audio"
          url: Type.String(),
          name: Type.Optional(Type.String()),
          mimeType: Type.Optional(Type.String()),
          size: Type.Optional(Type.Number()),
        })
      )
    ),
  }),

  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
```

### 1.3 Channel Outbound Message

Messages to users, to be formatted for platform.

```typescript
const ChannelOutboundMessage = Type.Object({
  channel: Type.String(),
  conversationId: Type.String(),
  sessionId: Type.Optional(Type.String()),
  replyToMessageId: Type.Optional(Type.String()),

  content: Type.Object({
    text: Type.String(),
    format: Type.Optional(
      Type.Union([Type.Literal('plain'), Type.Literal('markdown')])
    ),
    attachments: Type.Optional(
      Type.Array(
        Type.Object({
          type: Type.String(),
          data: Type.Union([Type.String(), Type.Any()]), // URL or buffer
          name: Type.Optional(Type.String()),
        })
      )
    ),
  }),

  options: Type.Optional(
    Type.Object({
      ephemeral: Type.Optional(Type.Boolean()),
      threadReply: Type.Optional(Type.Boolean()),
    })
  ),
});
```

### 1.3.1 Channel Policy Defaults

- **Registry**: Config-driven; loaded at startup (restart-to-reload)
- **Validation**: Strict config validation; unknown keys fail startup
- **Group contexts**: Mention-gating enabled by default
- **DMs**: Explicit allowlist required; pairing supported when enabled; DM config optional
- **Server/Guilds**: Explicit allowlist + channel ID allowlist required

### 1.3.2 Minimal Channel Config Schema (Per Platform)

Each platform provides a minimal, explicit configuration to keep setup simple and secure:

```typescript
const ChannelServerConfig = Type.Object({
  id: Type.String(), // Server/Guild/Workspace ID
  channel_ids: Type.Array(Type.String()),
  user_allowlist: Type.Array(Type.String()),
});

const ChannelBaseConfig = Type.Object({
  token: Type.String(),
  servers: Type.Array(ChannelServerConfig),
});
```

Platform-specific fields are permitted but must be explicitly enumerated per platform.

### 1.4 LLM Request

```typescript
const LLMRequest = Type.Object({
  sessionId: Type.String(),

  messages: Type.Array(
    Type.Object({
      role: Type.Union([
        Type.Literal('system'),
        Type.Literal('user'),
        Type.Literal('assistant'),
        Type.Literal('tool'),
      ]),
      content: Type.Union([
        Type.String(),
        Type.Array(
          Type.Object({
            type: Type.String(),
            text: Type.Optional(Type.String()),
            image_url: Type.Optional(Type.String()),
            tool_use_id: Type.Optional(Type.String()),
            tool_result: Type.Optional(Type.Unknown()),
          })
        ),
      ]),
      name: Type.Optional(Type.String()),
      tool_call_id: Type.Optional(Type.String()),
    })
  ),

  tools: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String(),
        description: Type.String(),
        parameters: Type.Object({}), // JSON Schema
      })
    )
  ),

  options: Type.Optional(
    Type.Object({
      model: Type.Optional(Type.String()),
      maxTokens: Type.Optional(Type.Number()),
      temperature: Type.Optional(Type.Number()),
      stream: Type.Optional(Type.Boolean()),
    })
  ),
});
```

### 1.5 LLM Response

```typescript
const LLMResponse = Type.Object({
  sessionId: Type.String(),
  success: Type.Boolean(),
  message: Type.Optional(LLMMessage),
  toolCalls: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.String(),
        name: Type.String(),
        arguments: Type.String(), // JSON string
      })
    )
  ),
  usage: Type.Optional(
    Type.Object({
      promptTokens: Type.Optional(Type.Number()),
      completionTokens: Type.Optional(Type.Number()),
      totalTokens: Type.Optional(Type.Number()),
    })
  ),
  provider: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  finishReason: Type.Optional(Type.String()),
  error: Type.Optional(
    Type.Object({
      code: Type.String(),
      message: Type.String(),
      providerCode: Type.Optional(Type.String()),
    })
  ),
});
```

### 1.6 LLM Stream Chunk

```typescript
const LLMStreamChunk = Type.Object({
  sessionId: Type.String(),
  index: Type.Number(),
  type: Type.Union([
    Type.Literal('delta'),
    Type.Literal('tool_call'),
    Type.Literal('tool_result'),
    Type.Literal('metadata'),
    Type.Literal('done'),
  ]),
  delta: Type.Optional(Type.String()),
  toolCall: Type.Optional(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      arguments: Type.String(),
    })
  ),
  usage: Type.Optional(
    Type.Object({
      promptTokens: Type.Optional(Type.Number()),
      completionTokens: Type.Optional(Type.Number()),
      totalTokens: Type.Optional(Type.Number()),
    })
  ),
  provider: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  finishReason: Type.Optional(Type.String()),
});
```

### 1.6.1 LLM Failover Behavior

- Fallback is **config-only** and **silent** when unset.
- Fallback order is a single ordered list of `provider:model` entries.
- If the list is missing or empty, the proxy returns the original provider error.

### 1.7 Tool Request/Response

```typescript
const ToolRequest = Type.Object({
  sessionId: Type.String(),
  tool: Type.String(),
  callId: Type.String(),
  parameters: Type.Record(Type.String(), Type.Unknown()),
});

const ToolResponse = Type.Object({
  sessionId: Type.String(),
  callId: Type.String(),
  success: Type.Boolean(),
  result: Type.Optional(Type.Unknown()),
  error: Type.Optional(
    Type.Object({
      code: Type.String(),
      message: Type.String(),
    })
  ),
});
```

### 1.8 Policy Check Request/Response

```typescript
const PolicyCheckRequest = Type.Object({
  sessionId: Type.String(),
  action: Type.String(), // "tool.execute", "channel.send", etc.
  resource: Type.String(), // "tool.filesystem", "channel.slack", etc.
  context: Type.Record(Type.String(), Type.Unknown()),
});

const PolicyCheckResponse = Type.Object({
  allowed: Type.Boolean(),
  reason: Type.Optional(Type.String()),
  conditions: Type.Optional(Type.Array(Type.String())),
  auditId: Type.String(),
});
```

---

## 2. NATS Topic Structure

### 2.1 Topic Naming Convention

```
nachos.<domain>.<component>.<action>
```

### 2.2 Topic Definitions

| Topic                       | Publisher | Subscriber | Purpose           |
| --------------------------- | --------- | ---------- | ----------------- |
| `nachos.channel.*.inbound`  | Channel   | Gateway    | User messages     |
| `nachos.channel.*.outbound` | Gateway   | Channel    | Responses         |
| `nachos.llm.request`        | Gateway   | LLM Proxy  | Completions       |
| `nachos.llm.response`       | LLM Proxy | Gateway    | Results           |
| `nachos.llm.stream.*`       | LLM Proxy | Gateway    | Streaming chunks  |
| `nachos.tool.*.request`     | Gateway   | Tool       | Invocations       |
| `nachos.tool.*.response`    | Tool      | Gateway    | Results           |
| `nachos.policy.check`       | Any       | Salsa      | Policy evaluation |
| `nachos.policy.result`      | Salsa     | Requester  | Policy decision   |
| `nachos.audit.log`          | Any       | Salsa      | Audit events      |
| `nachos.health.ping`        | Any       | Any        | Health checks     |

### 2.3 Request/Reply Pattern

Use NATS request/reply for synchronous operations:

```typescript
// Requester
const response = await nc.request('nachos.policy.check', payload, {
  timeout: 5000,
});

// Responder
const sub = nc.subscribe('nachos.policy.check');
for await (const msg of sub) {
  const result = await evaluatePolicy(msg.data);
  msg.respond(result);
}
```

---

## 3. Session Management

### 3.1 Session Schema

```typescript
interface Session {
  id: string; // UUID
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp

  // Identity
  channel: string; // Source channel
  conversationId: string; // Platform conversation ID
  userId: string; // Platform user ID

  // State
  status: 'active' | 'paused' | 'ended';

  // Conversation
  messages: Message[]; // Conversation history
  systemPrompt: string; // Active system prompt

  // Configuration (can override global)
  config: {
    model?: string;
    maxTokens?: number;
    tools?: string[]; // Enabled tool names
  };

  // Metadata
  metadata: Record<string, unknown>;
}
```

### 3.2 Session Lifecycle

```
┌─────────┐     ┌─────────┐     ┌─────────┐
│ Created │ ──▶ │ Active  │ ──▶ │  Ended  │
└─────────┘     └────┬────┘     └─────────┘
                     │
                     ▼
                ┌─────────┐
                │ Paused  │
                └─────────┘
```

### 3.3 Session Storage

SQLite schema:

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  system_prompt TEXT,
  config JSON,
  metadata JSON,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  UNIQUE(channel, conversation_id)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls JSON,
  created_at TEXT NOT NULL,

  INDEX idx_session_id (session_id)
);
```

---

## 4. Policy Engine

### 4.1 Policy Schema

```yaml
# policies/default.yaml
version: 1
name: default

rules:
  # Rule structure
  - name: 'rule-name'
    description: 'What this rule does'

    # When does this rule apply?
    match:
      action: 'tool.execute' # Action being performed
      resource: 'tool.filesystem' # Resource being accessed
      # Can use wildcards: "tool.*"

    # Additional conditions
    conditions:
      - type: 'security_mode'
        values: ['standard', 'permissive']
      - type: 'session_owner'
        value: true
      - type: 'path_allowed'
        paths: ['./workspace']

    # What to do
    effect: 'allow' # "allow" | "deny" | "audit"

    # Priority (higher = evaluated first)
    priority: 100
```

### 4.2 Built-in Condition Types

| Type             | Description                | Parameters                      |
| ---------------- | -------------------------- | ------------------------------- |
| `security_mode`  | Current security mode      | `values: string[]`              |
| `session_owner`  | Is requester session owner | `value: boolean`                |
| `path_allowed`   | File path in allowed list  | `paths: string[]`               |
| `domain_allowed` | URL domain in allowed list | `domains: string[]`             |
| `rate_limit`     | Under rate limit           | `limit: number, window: string` |
| `time_of_day`    | Within time window         | `start: string, end: string`    |

### 4.3 Policy Evaluation

```typescript
interface PolicyEvaluator {
  evaluate(request: PolicyCheckRequest): Promise<PolicyDecision>;
}

interface PolicyDecision {
  allowed: boolean;
  matchedRule: string | null;
  reason: string;
  conditions: string[];
}

// Evaluation order:
// 1. Find all rules matching action + resource
// 2. Sort by priority (descending)
// 3. Evaluate conditions for each rule
// 4. First rule with all conditions met wins
// 5. If no rules match, default deny
```

---

## 5. Container Specifications

### 5.1 Base Container Template

```dockerfile
# All Nachos containers inherit from this pattern
FROM node:22-alpine

# Security: non-root user
RUN addgroup -g 1000 nachos && \
    adduser -u 1000 -G nachos -s /bin/sh -D nachos

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application
COPY --chown=nachos:nachos dist/ ./dist/

# Security: drop privileges
USER nachos

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node dist/healthcheck.js || exit 1

CMD ["node", "dist/index.js"]
```

### 5.2 Container Security Defaults

Applied via docker-compose:

```yaml
x-security-defaults: &security-defaults
  security_opt:
    - no-new-privileges:true
  cap_drop:
    - ALL
  read_only: true
  user: '1000:1000'
  mem_limit: 512m
  cpus: 0.5
  pids_limit: 100
  tmpfs:
    - /tmp:size=64m,mode=1777
```

### 5.3 Component Resource Profiles

| Component   | Memory | CPU  | Network  |
| ----------- | ------ | ---- | -------- |
| Gateway     | 512MB  | 0.5  | internal |
| Bus (NATS)  | 256MB  | 0.25 | internal |
| Salsa       | 256MB  | 0.25 | internal |
| LLM Proxy   | 256MB  | 0.25 | egress   |
| WebChat     | 256MB  | 0.25 | internal |
| Slack       | 256MB  | 0.25 | egress   |
| Discord     | 256MB  | 0.25 | egress   |
| Filesystem  | 128MB  | 0.25 | internal |
| Browser     | 1GB    | 1.0  | egress   |
| Code Runner | 512MB  | 0.5  | internal |

---

## 6. CLI Specifications

### 6.1 Command Structure

```
nachos <command> [subcommand] [options]

Commands:
  init                Initialize new Nachos project
  up [service...]     Start services
  down                Stop all services
  restart [service]   Restart service(s)
  logs [service]      View logs
  status              Show status

  add <type> <name>   Add channel or tool
  remove <type> <n>   Remove channel or tool
  list [type]         List installed modules
  search <type>       Search available modules

  config              Open config in editor
  config validate     Validate configuration
  config show         Show resolved config

  doctor              Run diagnostics
  version             Show version info

  create channel <n>  Scaffold custom channel
  create tool <name>  Scaffold custom tool

  chat                Interactive CLI chat
```

### 6.2 Config Resolution Order

1. Default values (built-in)
2. `nachos.toml` in current directory
3. `~/.nachos/nachos.toml` (global)
4. Environment variables (`NACHOS_*`)
5. CLI flags

### 6.3 Compose Generation

The CLI generates `docker-compose.yml` from:

1. Read `nachos.toml`
2. Determine enabled components
3. Load manifest for each component
4. Resolve dependencies
5. Generate service definitions
6. Apply security defaults
7. Configure networks
8. Write `docker-compose.yml`

---

## 7. Module Manifest Specification

### 7.1 Full Manifest Schema

```typescript
interface ModuleManifest {
  // Identity
  name: string; // "nachos-channel-slack"
  version: string; // semver
  type: 'channel' | 'tool' | 'skill';

  // Metadata
  description: string;
  author?: string;
  license?: string;
  repository?: string;

  // Dependencies
  requires: {
    gateway?: string; // Version constraint
    bus?: string;
    [key: string]: string | undefined;
  };

  // Capabilities needed
  capabilities: {
    network?: {
      egress?: string[]; // Allowed external domains
      ports?: number[]; // Exposed ports
    };
    secrets?: string[]; // Required env vars
    volumes?: Array<{
      name: string;
      path: string;
      mode: 'ro' | 'rw';
    }>;
    permissions?: string[]; // Special permissions
  };

  // What this module provides
  provides: {
    channel?: string; // Channel identifier
    tool?: string; // Tool identifier
    skill?: string; // Skill identifier
    features?: string[]; // Supported features
  };

  // Container configuration
  container: {
    image: string; // Docker image
    tag?: string; // Image tag
    command?: string[]; // Override CMD
    resources?: {
      memory?: string; // e.g., "256MB"
      cpus?: number; // e.g., 0.5
    };
    healthcheck?: {
      test: string[];
      interval?: string;
      timeout?: string;
      retries?: number;
    };
  };

  // Configuration schema
  config?: {
    schema: object; // JSON Schema for config options
    defaults: object; // Default values
  };
}
```

---

## 8. Error Handling

### 8.1 Error Schema

```typescript
interface NachosError {
  code: string; // "NACHOS_ERR_xxx"
  message: string; // Human-readable
  component: string; // Source component
  details?: object; // Additional context
  timestamp: string; // ISO timestamp
  correlationId?: string;
}
```

### 8.2 Error Codes

| Code                           | Description              |
| ------------------------------ | ------------------------ |
| `NACHOS_ERR_CONFIG`            | Configuration error      |
| `NACHOS_ERR_POLICY_DENIED`     | Policy check failed      |
| `NACHOS_ERR_RATE_LIMITED`      | Rate limit exceeded      |
| `NACHOS_ERR_LLM_FAILED`        | LLM request failed       |
| `NACHOS_ERR_TOOL_FAILED`       | Tool execution failed    |
| `NACHOS_ERR_CHANNEL_FAILED`    | Channel operation failed |
| `NACHOS_ERR_SESSION_NOT_FOUND` | Session doesn't exist    |
| `NACHOS_ERR_TIMEOUT`           | Operation timed out      |
| `NACHOS_ERR_INTERNAL`          | Internal error           |

---

## 9. Observability

### 9.1 Health Check Endpoint

Every component exposes:

```
GET /health

Response:
{
  "status": "healthy" | "degraded" | "unhealthy",
  "component": "gateway",
  "version": "1.0.0",
  "uptime": 3600,
  "checks": {
    "bus": "ok",
    "database": "ok"
  }
}
```

### 9.2 Logging Format

JSON structured logging:

```json
{
  "timestamp": "2025-01-30T12:00:00.000Z",
  "level": "info",
  "component": "gateway",
  "message": "Session created",
  "sessionId": "abc-123",
  "correlationId": "req-456",
  "duration": 45
}
```

### 9.3 Metrics (Future)

Prometheus-compatible metrics at `/metrics`:

- `nachos_messages_total{channel,status}`
- `nachos_llm_requests_total{provider,model,status}`
- `nachos_tool_executions_total{tool,status}`
- `nachos_policy_decisions_total{action,result}`
- `nachos_session_count{status}`

---

## 10. Testing Strategy

### 10.1 Test Levels

| Level       | Scope                    | Tools                   |
| ----------- | ------------------------ | ----------------------- |
| Unit        | Single function/class    | Vitest                  |
| Integration | Component + dependencies | Vitest + Testcontainers |
| E2E         | Full stack               | Playwright + Docker     |

### 10.2 Test Structure

```
packages/
  gateway/
    src/
    tests/
      unit/
        router.test.ts
        session.test.ts
      integration/
        gateway-bus.test.ts
      fixtures/

tests/
  e2e/
    conversation.test.ts
    tool-execution.test.ts
```

### 10.3 CI Pipeline

```yaml
# .github/workflows/ci.yml
jobs:
  test:
    steps:
      - Unit tests (all packages)
      - Integration tests (with testcontainers)
      - Build Docker images
      - E2E tests (full stack)
      - Security scan (trivy)
```
