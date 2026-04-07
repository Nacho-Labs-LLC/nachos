# Creating Custom Modules

Nachos is built to be extended. This guide covers adding your own channels,
tools, and skills.

---

## Overview

There are three extension points:

| Type        | What It Does                                        | Where It Lives                     |
| ----------- | --------------------------------------------------- | ---------------------------------- |
| **Channel** | Connect Nachos to a messaging platform              | `packages/channels/<name>/`        |
| **Tool**    | Let Nachos take actions (run code, call APIs, etc.) | `packages/tools/<name>/`           |
| **Skill**   | Give Nachos knowledge for an external service       | `workspace/skills/<name>/SKILL.md` |

Skills are the easiest — just a Markdown file, no code required. Channels and
tools require TypeScript packages.

---

## 1. Adding a Skill (Simplest)

A skill teaches Nachos how to use an external tool or API. No code required.

```bash
mkdir -p workspace/skills/my-service
```

Create `workspace/skills/my-service/SKILL.md`:

```markdown
---
name: my-service
description: Interact with MyService API
---

# My Service

Brief description of what this skill enables.

## Authentication

\`\`\`bash export MY_SERVICE_API_KEY="your-key-here" \`\`\`

## Common Operations

### List items

\`\`\`bash curl -H "Authorization: Bearer $MY_SERVICE_API_KEY" \
 https://api.myservice.com/v1/items \`\`\`

Expected response: \`\`\`json {"items": [...], "total": 42} \`\`\`

## Troubleshooting

**401 Unauthorized** — Check your API key is set and valid. **404 Not Found** —
The resource ID doesn't exist or you don't have access.
```

Skills are auto-discovered on next session start. See
[SKILL_TOOLS.md](SKILL_TOOLS.md) for the full catalog and
[ADR-003](adr/003-skill-structure.md) for format details.

---

## 2. Adding a Tool (Medium)

Tools let Nachos take programmatic actions. They are TypeScript packages in
`packages/tools/`.

### Scaffold

```bash
# Copy the filesystem tool as a starting point
cp -r packages/tools/filesystem packages/tools/my-tool
cd packages/tools/my-tool
```

Update `package.json`:

```json
{
  "name": "@nachos/tool-my-tool",
  "version": "0.1.0"
}
```

### Implement the Tool Interface

```typescript
// src/index.ts
import type {
  NachosTool,
  ToolDefinition,
  ToolContext,
  ToolResult,
} from '@nachos/shared';

export class MyTool implements NachosTool {
  readonly name = 'my-tool';

  get definition(): ToolDefinition {
    return {
      name: 'my_tool',
      description: 'What this tool does',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The query to process',
          },
        },
        required: ['query'],
      },
    };
  }

  async execute(
    params: { query: string },
    context: ToolContext
  ): Promise<ToolResult> {
    // Your tool logic here
    const result = await doSomething(params.query);
    return {
      success: true,
      output: result,
    };
  }
}
```

### Register with Gateway

Add to `packages/core/gateway/src/tools/index.ts`:

```typescript
import { MyTool } from '@nachos/tool-my-tool';
// ...
toolRegistry.register(new MyTool());
```

### Enable in Config

```toml
[[tools]]
type = "my-tool"
# Add any tool-specific config here
```

---

## 3. Adding a Channel (Advanced)

Channels connect Nachos to messaging platforms. They publish and subscribe to
the message bus.

### Scaffold

```bash
cp -r packages/channels/discord packages/channels/my-channel
cd packages/channels/my-channel
```

### Implement the Channel Interface

```typescript
// src/index.ts
import type {
  NachosChannel,
  InboundMessage,
  OutboundMessage,
} from '@nachos/shared';

export class MyChannel implements NachosChannel {
  readonly name = 'my-channel';

  async start(): Promise<void> {
    // Connect to your platform
    // Subscribe to incoming events
    // Call this.onMessage(msg) when a message arrives
  }

  async stop(): Promise<void> {
    // Graceful shutdown
  }

  async send(msg: OutboundMessage): Promise<void> {
    // Deliver message to the platform
  }
}
```

### Register with Gateway

Add to `packages/core/gateway/src/channel-registry.ts`.

### Enable in Config

```toml
[[channels]]
type = "my-channel"
token = "${MY_CHANNEL_TOKEN}"
```

---

## Testing Your Module

```bash
# Run tests for your package
cd packages/tools/my-tool
pnpm test

# Integration test against the full stack
./docker/test-infrastructure.sh
```

---

## Tips

- **Start with a skill** — if you just need to call an API, a skill is almost
  always enough. Save tool/channel work for things that genuinely need
  programmatic integration.
- **Look at existing packages** — `packages/tools/web-fetch` is a good minimal
  tool example; `packages/channels/discord` is the most complete channel
  example.
- **Security**: Tools run with the security mode of the gateway. If your tool
  does sensitive operations, document it clearly and test with `strict` mode.
- **Error handling**: Return descriptive errors from `execute()`. The LLM uses
  your error messages to self-correct.

---

## Further Reading

- [SKILL_TOOLS.md](SKILL_TOOLS.md) — catalog of existing skills
- [ADR-003: Skill Structure](adr/003-skill-structure.md) — skill format
  rationale
- [Architecture Overview](architecture.md) — how channels, tools, and gateway
  connect
- [Security Guide](security.md) — security model and tool permissions
