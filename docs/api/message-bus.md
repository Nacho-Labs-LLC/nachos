# Message Bus API

**Status**: Draft  
**Version**: 1.0.0-alpha

## Overview

The Message Bus API defines the NATS-based communication protocol used by all Nachos components.

## Connection

### Configuration

Components connect to NATS using environment variables:

```typescript
const NATS_URL = process.env.NATS_URL || 'nats://bus:4222';
const NATS_CLUSTER_ID = process.env.NATS_CLUSTER_ID || 'nachos';
```

### Connection Example

```typescript
import { connect, StringCodec } from 'nats';

const nc = await connect({
  servers: NATS_URL,
  name: 'gateway',
  reconnect: true,
  maxReconnectAttempts: -1,
});

const sc = StringCodec();
```

## Message Envelope

All messages use a common envelope structure:

```typescript
interface MessageEnvelope<T = unknown> {
  id: string; // UUID
  timestamp: string; // ISO 8601
  source: string; // Component name
  type: string; // Message type
  correlationId?: string; // For request/reply tracking
  payload: T;
}
```

## Topics

### Topic Naming Convention

```
nachos.<domain>.<component>.<action>
```

Examples:

- `nachos.channel.slack.inbound`
- `nachos.tool.browser.request`
- `nachos.llm.request`

### Topic Hierarchy

```
nachos
├── channel
│   ├── {channel-name}
│   │   ├── inbound      # User messages
│   │   └── outbound     # Assistant responses
│   └── *                # Subscribe to all channels
├── llm
│   ├── request          # LLM completion requests
│   ├── response         # LLM responses
│   └── stream.{id}      # Streaming chunks
├── tool
│   ├── {tool-name}
│   │   ├── request      # Tool invocations
│   │   └── response     # Tool results
│   └── *                # Subscribe to all tools
├── policy
│   ├── check            # Policy evaluation requests
│   └── result           # Policy decisions
├── audit
│   └── log              # Audit events (JetStream)
└── health
    └── ping             # Health checks
```

## Message Types

### 1. Channel Inbound

**Topic**: `nachos.channel.{channel}.inbound`  
**Pattern**: Publish/Subscribe

User messages from a channel, normalized to common format.

```typescript
interface ChannelInboundPayload {
  channel: string;
  channelMessageId: string;
  sessionId?: string;

  sender: {
    id: string;
    name?: string;
    isAllowed: boolean;
  };

  conversation: {
    id: string;
    type: 'dm' | 'channel' | 'thread';
  };

  content: {
    text?: string;
    attachments?: Array<{
      type: string;
      url: string;
      name?: string;
      mimeType?: string;
      size?: number;
    }>;
  };

  metadata?: Record<string, unknown>;
}
```

**Example**:

```typescript
await nc.publish(
  'nachos.channel.slack.inbound',
  sc.encode(
    JSON.stringify({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      source: 'slack',
      type: 'channel.inbound',
      payload: {
        channel: 'slack',
        channelMessageId: '1234.5678',
        sender: {
          id: 'U01234',
          name: 'John Doe',
          isAllowed: true,
        },
        conversation: {
          id: 'C01234',
          type: 'channel',
        },
        content: {
          text: 'Hello, Nachos!',
        },
      },
    })
  )
);
```

### 2. Channel Outbound

**Topic**: `nachos.channel.{channel}.outbound`  
**Pattern**: Publish/Subscribe

Messages to send to users through a channel.

```typescript
interface ChannelOutboundPayload {
  channel: string;
  conversationId: string;
  replyToMessageId?: string;

  content: {
    text: string;
    format?: 'plain' | 'markdown';
    attachments?: Array<{
      type: string;
      data: string; // URL or base64
      name?: string;
    }>;
  };

  options?: {
    ephemeral?: boolean;
    threadReply?: boolean;
  };
}
```

### 3. LLM Request

**Topic**: `nachos.llm.request`  
**Pattern**: Request/Reply (timeout: 60s)

Request LLM completion.

```typescript
interface LLMRequestPayload {
  sessionId: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | Array<ContentBlock>;
    name?: string;
    tool_call_id?: string;
  }>;
  tools?: Array<ToolDefinition>;
  options?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    stream?: boolean;
  };
}

interface LLMResponsePayload {
  sessionId: string;
  message: {
    role: 'assistant';
    content: string;
    toolCalls?: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string; // JSON string
      };
    }>;
  };
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
```

**Example**:

```typescript
const response = await nc.request(
  'nachos.llm.request',
  sc.encode(JSON.stringify(envelope)),
  { timeout: 60000 }
);

const result: MessageEnvelope<LLMResponsePayload> = JSON.parse(
  sc.decode(response.data)
);
```

### 4. Tool Request/Response

**Topic**: `nachos.tool.{tool}.request`, `nachos.tool.{tool}.response`  
**Pattern**: Request/Reply (timeout: 30s)

Execute a tool.

```typescript
interface ToolRequestPayload {
  sessionId: string;
  tool: string;
  callId: string;
  parameters: Record<string, unknown>;
}

interface ToolResponsePayload {
  sessionId: string;
  callId: string;
  success: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
}
```

### 5. Policy Check

**Topic**: `nachos.policy.check`  
**Pattern**: Request/Reply (timeout: 5s)

Check if an action is allowed by policy.

```typescript
interface PolicyCheckPayload {
  sessionId: string;
  action: string;
  resource: string;
  context: Record<string, unknown>;
}

interface PolicyResultPayload {
  allowed: boolean;
  reason?: string;
  conditions?: string[];
  auditId: string;
}
```

### 6. Audit Log

**Topic**: `nachos.audit.log`  
**Pattern**: Publish (JetStream for persistence)

Log audit events.

```typescript
interface AuditLogPayload {
  sessionId: string;
  userId: string;
  action: string;
  resource: string;
  result: 'allowed' | 'denied';
  reason?: string;
  metadata?: Record<string, unknown>;
}
```

## Communication Patterns

### Publish/Subscribe

For fire-and-forget messages (events, logs):

```typescript
// Publisher
await nc.publish(topic, sc.encode(JSON.stringify(message)));

// Subscriber
const sub = nc.subscribe(topic);
for await (const msg of sub) {
  const envelope = JSON.parse(sc.decode(msg.data));
  await handleMessage(envelope);
}
```

### Request/Reply

For synchronous operations requiring a response:

```typescript
// Requester
const response = await nc.request(topic, payload, { timeout: 30000 });

// Responder
const sub = nc.subscribe(topic);
for await (const msg of sub) {
  const result = await processRequest(msg.data);
  msg.respond(sc.encode(JSON.stringify(result)));
}
```

### Streaming

For long-running operations with progress updates:

```typescript
// Publisher (streamer)
const streamId = crypto.randomUUID();
for await (const chunk of generateChunks()) {
  await nc.publish(`nachos.llm.stream.${streamId}`, chunk);
}

// Subscriber
const sub = nc.subscribe(`nachos.llm.stream.${streamId}`);
for await (const msg of sub) {
  handleChunk(msg.data);
}
```

## Error Handling

### Connection Errors

```typescript
nc.closed().then((err) => {
  if (err) {
    console.error('Connection closed with error:', err);
    process.exit(1);
  }
});
```

### Request Timeouts

```typescript
try {
  const response = await nc.request(topic, payload, { timeout: 5000 });
} catch (err) {
  if (err.code === 'TIMEOUT') {
    console.error('Request timed out');
  }
}
```

### Invalid Messages

Always validate message schemas:

```typescript
import { validate } from './schemas';

const sub = nc.subscribe(topic);
for await (const msg of sub) {
  try {
    const envelope = JSON.parse(sc.decode(msg.data));
    if (!validate(envelope)) {
      console.error('Invalid message:', validate.errors);
      continue;
    }
    await handleMessage(envelope);
  } catch (err) {
    console.error('Failed to process message:', err);
  }
}
```

## Best Practices

1. **Always use UUIDs** for message IDs
2. **Include timestamps** in ISO 8601 format
3. **Validate all messages** against schemas
4. **Handle reconnections** gracefully
5. **Set appropriate timeouts** (5s for policy, 30s for tools, 60s for LLM)
6. **Use correlation IDs** for request/reply tracking
7. **Log all errors** with context
8. **Use JetStream** for messages that must not be lost

## Testing

Mock NATS for unit tests:

```typescript
import { vi } from 'vitest';

const mockNats = {
  publish: vi.fn(),
  request: vi.fn(),
  subscribe: vi.fn(),
};
```

Use testcontainers for integration tests:

```typescript
import { NatsContainer } from '@testcontainers/nats';

const container = await new NatsContainer().start();
const nc = await connect({ servers: container.getConnectionUrl() });
```

## References

- [NATS Documentation](https://docs.nats.io/)
- [NATS Protocol](https://docs.nats.io/reference/reference-protocols/nats-protocol)
- [JetStream](https://docs.nats.io/nats-concepts/jetstream)
