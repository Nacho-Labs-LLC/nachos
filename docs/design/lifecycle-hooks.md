# Lifecycle Hooks Design

> **Status**: Draft **Date**: 2026-03-04 **Author**: Backend Architect
> **Scope**: `packages/core/gateway/src/hooks/`

## Overview

The lifecycle hooks system allows plugin developers to react to key gateway
events without modifying core gateway code. It uses a typed EventEmitter pattern
-- handlers register for specific hook points, the gateway emits events at those
points, and handlers execute in priority order.

This is intentionally simple: not a middleware chain, not a plugin framework.
Hooks observe and optionally annotate events. They cannot block the pipeline
(exceptions are caught and logged).

## Motivation

As Nachos grows, external integrations need visibility into the message
lifecycle: analytics, custom logging, webhook forwarding, content filtering, A/B
testing of prompts, and more. Without hooks, every such extension requires
modifying `gateway.ts` directly. Hooks decouple these concerns.

## Architecture

### Design Principles

1. **Typed payloads** -- Each hook point has a concrete TypeScript type for its
   event payload. Handlers receive exactly the data available at that point.
2. **Priority ordering** -- Handlers execute in ascending numeric priority
   (lower = earlier). Default priority is 100.
3. **Fault isolation** -- If a handler throws, the error is logged and the next
   handler runs. Hooks never crash the gateway.
4. **Async by default** -- All handlers return `Promise<void>`. They execute
   sequentially in priority order so that earlier hooks can annotate shared
   context before later hooks read it.
5. **Zero dependencies** -- The hook system uses only built-in TypeScript and
   the project's existing logger. No external EventEmitter libraries.

### Non-Goals

- Hooks do NOT replace policy evaluation (Cheese) or DLP scanning.
- Hooks do NOT modify the core data flow. They observe it. (Future: mutating
  hooks could be considered via a separate "middleware" layer.)
- Hooks do NOT provide dependency injection or plugin lifecycle management.

## Hook Points

### Message Flow Hooks

| Hook                 | When                                                          | Payload Summary                                         |
| -------------------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| `onMessageReceived`  | Inbound message arrives from a channel, before any processing | Channel, sender, conversation, raw content              |
| `beforeLLMRequest`   | LLM request is built, about to be sent to the LLM proxy       | Session ID, messages array, tools, options              |
| `afterLLMResponse`   | LLM response received from the proxy                          | Session ID, response (success/error, tool calls, usage) |
| `onToolCall`         | A tool is about to be executed                                | Session ID, tool name, call ID, parameters              |
| `afterToolCall`      | A tool has finished executing                                 | Session ID, tool name, call ID, result (success/error)  |
| `beforeResponseSent` | Response is about to be sent back to the channel              | Channel, conversation ID, session ID, content           |

### Session Lifecycle Hooks

| Hook                 | When                                               | Payload Summary    |
| -------------------- | -------------------------------------------------- | ------------------ |
| `onSessionCreated`   | A new session has been created (after store write) | Session object     |
| `onSessionDestroyed` | A session is being cleaned up / ended              | Session ID, reason |

### Gateway Lifecycle Hooks

| Hook         | When                                                      | Payload Summary                       |
| ------------ | --------------------------------------------------------- | ------------------------------------- |
| `onStartup`  | Gateway has finished starting (after `start()` completes) | Instance ID, channels, config summary |
| `onShutdown` | Gateway is about to stop (beginning of `stop()`)          | Instance ID, reason                   |

## Payload Types

### `onMessageReceived`

```typescript
interface MessageReceivedEvent {
  /** Envelope ID from the bus */
  envelopeId: string;
  /** Channel identifier (slack, discord, etc.) */
  channel: string;
  /** Channel-specific message ID */
  channelMessageId: string;
  /** Sender information */
  sender: { id: string; name?: string; isAllowed: boolean };
  /** Conversation context */
  conversation: { id: string; type: 'dm' | 'channel' | 'thread' };
  /** Raw message text (after DLP redaction if applicable) */
  text: string;
  /** Session ID (may be a new session) */
  sessionId: string;
  /** Timestamp of receipt */
  timestamp: string;
}
```

### `beforeLLMRequest`

```typescript
interface BeforeLLMRequestEvent {
  sessionId: string;
  /** The full messages array about to be sent */
  messages: ReadonlyArray<{ role: string; content: string | unknown[] }>;
  /** Tool definitions included in the request */
  tools: ReadonlyArray<{ name: string; description: string }> | undefined;
  /** Whether streaming is enabled */
  stream: boolean;
  /** Request options (model, maxTokens, etc.) */
  options: Record<string, unknown> | undefined;
  timestamp: string;
}
```

### `afterLLMResponse`

```typescript
interface AfterLLMResponseEvent {
  sessionId: string;
  success: boolean;
  /** Text content from the response */
  responseText: string | undefined;
  /** Tool calls requested by the LLM */
  toolCalls:
    | ReadonlyArray<{ id: string; name: string; arguments: string }>
    | undefined;
  /** Token usage metrics */
  usage:
    | { promptTokens?: number; completionTokens?: number; totalTokens?: number }
    | undefined;
  /** LLM provider name */
  provider: string | undefined;
  /** Model used */
  model: string | undefined;
  /** Finish reason (stop, tool_use, etc.) */
  finishReason: string | undefined;
  /** Error details if success is false */
  error: { code: string; message: string } | undefined;
  /** Current tool iteration depth */
  toolIteration: number;
  timestamp: string;
}
```

### `onToolCall`

```typescript
interface ToolCallEvent {
  sessionId: string;
  /** Tool name being called */
  toolName: string;
  /** Unique call identifier */
  callId: string;
  /** Tool parameters (parsed JSON) */
  parameters: Record<string, unknown>;
  /** Tool group for policy purposes */
  toolGroup: string | undefined;
  timestamp: string;
}
```

### `afterToolCall`

```typescript
interface AfterToolCallEvent {
  sessionId: string;
  toolName: string;
  callId: string;
  /** Whether the tool call succeeded */
  success: boolean;
  /** Result summary (may be truncated for large results) */
  resultSummary: string | undefined;
  /** Error details if the call failed */
  error: { code: string; message: string } | undefined;
  /** Execution duration in milliseconds */
  durationMs: number;
  timestamp: string;
}
```

### `beforeResponseSent`

```typescript
interface BeforeResponseSentEvent {
  sessionId: string;
  channel: string;
  conversationId: string;
  /** The text content about to be sent */
  text: string;
  /** Message format */
  format: 'plain' | 'markdown' | undefined;
  /** Whether this is a reply to a specific message */
  replyToMessageId: string | undefined;
  timestamp: string;
}
```

### `onSessionCreated`

```typescript
interface SessionCreatedEvent {
  /** The newly created session */
  session: {
    id: string;
    channel: string;
    conversationId: string;
    userId: string;
    status: string;
    createdAt: string;
  };
  timestamp: string;
}
```

### `onSessionDestroyed`

```typescript
interface SessionDestroyedEvent {
  sessionId: string;
  reason: 'user_command' | 'timeout' | 'shutdown' | 'admin';
  timestamp: string;
}
```

### `onStartup`

```typescript
interface StartupEvent {
  instanceId: string;
  /** Channels subscribed to */
  channels: string[];
  /** Active security mode */
  securityMode: 'strict' | 'standard' | 'permissive';
  /** Whether streaming passthrough is enabled */
  streamingEnabled: boolean;
  timestamp: string;
}
```

### `onShutdown`

```typescript
interface ShutdownEvent {
  instanceId: string;
  reason: 'signal' | 'api' | 'error';
  timestamp: string;
}
```

## HookRegistry API

```typescript
class HookRegistry {
  /**
   * Register a handler for a specific hook event.
   * @param event - The hook event name
   * @param handler - Async handler function
   * @param priority - Execution order (lower = earlier, default 100)
   */
  register<E extends HookEvent>(
    event: E,
    handler: HookHandler<E>,
    priority?: number
  ): void;

  /**
   * Remove a previously registered handler.
   */
  unregister<E extends HookEvent>(event: E, handler: HookHandler<E>): boolean;

  /**
   * Emit an event to all registered handlers in priority order.
   * Errors are caught and logged; they never propagate.
   * Returns the count of handlers that executed successfully.
   */
  emit<E extends HookEvent>(
    event: E,
    payload: HookPayloadMap[E]
  ): Promise<number>;

  /**
   * Remove all handlers for a specific event, or all events.
   */
  clear(event?: HookEvent): void;

  /**
   * Get the count of registered handlers for an event.
   */
  handlerCount(event: HookEvent): number;
}
```

## Integration Plan (Future)

When the gateway is wired up, emit calls will be placed at these locations:

| Hook                 | Gateway Location                                                     |
| -------------------- | -------------------------------------------------------------------- |
| `onMessageReceived`  | `handleInboundMessage()` after validation and session resolution     |
| `beforeLLMRequest`   | `buildLLMRequest()` just before returning the request object         |
| `afterLLMResponse`   | `sendLLMResponse()` at the top, after receiving the response         |
| `onToolCall`         | `toolExecutor.executeToolCalls()` before each tool dispatch          |
| `afterToolCall`      | `toolExecutor.executeToolCalls()` after each tool completes          |
| `beforeResponseSent` | `sendLLMResponse()` just before `router.sendToChannel()`             |
| `onSessionCreated`   | `handleInboundMessage()` after `getOrCreateSessionAtomic()` when new |
| `onSessionDestroyed` | `resetSessionForCommand()` and session cleanup paths                 |
| `onStartup`          | End of `start()` method                                              |
| `onShutdown`         | Beginning of `stop()` method                                         |

The Gateway will accept an optional `HookRegistry` in its constructor options.
If not provided, a no-op default is used (zero overhead when hooks are not
needed).

## Error Handling

- Each handler invocation is wrapped in a try/catch.
- On error, the logger records the hook event name, handler identity (if
  available), and the error message/stack.
- Execution continues with the next handler.
- The `emit()` return value indicates how many handlers succeeded, allowing
  callers to detect partial failures if needed.

## Performance Considerations

- Hooks execute sequentially within a priority group. This ensures deterministic
  ordering but means slow hooks delay subsequent ones.
- A built-in timeout per handler (default 5000ms) prevents runaway hooks from
  blocking the pipeline indefinitely.
- When no hooks are registered for an event, `emit()` returns immediately
  (O(1)).
- The payload objects passed to hooks are shallow-frozen to prevent accidental
  mutation. Hooks that need to pass data between themselves should use a shared
  metadata map on the event.

## Testing Strategy

- Unit tests for HookRegistry: registration, ordering, error handling, clear.
- Integration tests: mock gateway emitting events, verify handler invocation
  order.
- Performance test: measure overhead of emit with 0, 1, 10, 100 handlers.

## Alternatives Considered

1. **Node.js EventEmitter** -- Lacks typed payloads and priority ordering. Would
   require wrapping anyway.
2. **Middleware chain (Koa-style)** -- More powerful but more complex. Hooks are
   read-only observers, not request transformers.
3. **RxJS Observables** -- Powerful but adds a heavy dependency for a simple use
   case.
4. **Bus-based hooks (NATS topics)** -- Considered publishing hook events to the
   bus. Rejected because hooks are gateway-internal; bus events are for
   inter-component communication.
