/**
 * Lifecycle Hook Types
 *
 * Type definitions for all gateway lifecycle hook events and their payloads.
 * Each hook point has a strongly-typed payload describing the data available
 * to handlers at that point in the message flow.
 */

// ---------------------------------------------------------------------------
// Message Flow Event Payloads
// ---------------------------------------------------------------------------

/**
 * Emitted when an inbound message arrives from a channel, after validation
 * and session resolution but before LLM processing.
 */
export interface MessageReceivedEvent {
  /** Envelope ID from the bus */
  readonly envelopeId: string;
  /** Channel identifier (slack, discord, etc.) */
  readonly channel: string;
  /** Channel-specific message ID */
  readonly channelMessageId: string;
  /** Sender information */
  readonly sender: {
    readonly id: string;
    readonly name?: string;
    readonly isAllowed: boolean;
  };
  /** Conversation context */
  readonly conversation: {
    readonly id: string;
    readonly type: 'dm' | 'channel' | 'thread';
  };
  /** Message text (after DLP redaction if applicable) */
  readonly text: string;
  /** Resolved session ID */
  readonly sessionId: string;
  /** ISO 8601 timestamp of receipt */
  readonly timestamp: string;
}

/**
 * Emitted just before the LLM request is sent to the proxy.
 */
export interface BeforeLLMRequestEvent {
  readonly sessionId: string;
  /** The full messages array about to be sent */
  readonly messages: ReadonlyArray<{
    readonly role: string;
    readonly content: string | readonly unknown[];
  }>;
  /** Tool definitions included in the request */
  readonly tools:
    | ReadonlyArray<{
        readonly name: string;
        readonly description: string;
      }>
    | undefined;
  /** Whether streaming is enabled for this request */
  readonly stream: boolean;
  /** Request options (model, maxTokens, temperature, etc.) */
  readonly options: Readonly<Record<string, unknown>> | undefined;
  readonly timestamp: string;
}

/**
 * Emitted after the LLM response is received from the proxy.
 */
export interface AfterLLMResponseEvent {
  readonly sessionId: string;
  readonly success: boolean;
  /** Text content extracted from the response */
  readonly responseText: string | undefined;
  /** Tool calls requested by the LLM */
  readonly toolCalls:
    | ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly arguments: string;
      }>
    | undefined;
  /** Token usage metrics */
  readonly usage:
    | {
        readonly promptTokens?: number;
        readonly completionTokens?: number;
        readonly totalTokens?: number;
      }
    | undefined;
  /** LLM provider name */
  readonly provider: string | undefined;
  /** Model used for this response */
  readonly model: string | undefined;
  /** Finish reason (stop, tool_use, length, etc.) */
  readonly finishReason: string | undefined;
  /** Error details when success is false */
  readonly error: { readonly code: string; readonly message: string } | undefined;
  /** Current tool iteration depth (0 = first request) */
  readonly toolIteration: number;
  readonly timestamp: string;
}

/**
 * Emitted when a tool is about to be called.
 */
export interface ToolCallEvent {
  readonly sessionId: string;
  /** Tool name being invoked */
  readonly toolName: string;
  /** Unique call identifier */
  readonly callId: string;
  /** Parsed tool parameters */
  readonly parameters: Readonly<Record<string, unknown>>;
  /** Tool group for policy grouping */
  readonly toolGroup: string | undefined;
  readonly timestamp: string;
}

/**
 * Emitted after a tool call has completed.
 */
export interface AfterToolCallEvent {
  readonly sessionId: string;
  readonly toolName: string;
  readonly callId: string;
  /** Whether the tool execution succeeded */
  readonly success: boolean;
  /** Summary of the result (may be truncated for large outputs) */
  readonly resultSummary: string | undefined;
  /** Error details if the call failed */
  readonly error: { readonly code: string; readonly message: string } | undefined;
  /** Execution duration in milliseconds */
  readonly durationMs: number;
  readonly timestamp: string;
}

/**
 * Emitted just before the final response is sent back to the channel.
 */
export interface BeforeResponseSentEvent {
  readonly sessionId: string;
  readonly channel: string;
  readonly conversationId: string;
  /** Text content about to be sent */
  readonly text: string;
  /** Message format */
  readonly format: 'plain' | 'markdown' | undefined;
  /** Message ID being replied to (for threading) */
  readonly replyToMessageId: string | undefined;
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------
// Session Lifecycle Event Payloads
// ---------------------------------------------------------------------------

/**
 * Emitted when a new session is created.
 */
export interface SessionCreatedEvent {
  /** Core session details */
  readonly session: {
    readonly id: string;
    readonly channel: string;
    readonly conversationId: string;
    readonly userId: string;
    readonly status: string;
    readonly createdAt: string;
  };
  readonly timestamp: string;
}

/**
 * Emitted when a session is destroyed or ended.
 */
export interface SessionDestroyedEvent {
  readonly sessionId: string;
  /** Why the session was destroyed */
  readonly reason: 'user_command' | 'timeout' | 'shutdown' | 'admin';
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------
// Gateway Lifecycle Event Payloads
// ---------------------------------------------------------------------------

/**
 * Emitted after the gateway has finished starting.
 */
export interface StartupEvent {
  readonly instanceId: string;
  /** Channels subscribed to */
  readonly channels: readonly string[];
  /** Active security mode */
  readonly securityMode: 'strict' | 'standard' | 'permissive';
  /** Whether streaming passthrough is enabled */
  readonly streamingEnabled: boolean;
  readonly timestamp: string;
}

/**
 * Emitted at the beginning of gateway shutdown.
 */
export interface ShutdownEvent {
  readonly instanceId: string;
  /** Why the gateway is shutting down */
  readonly reason: 'signal' | 'api' | 'error';
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------
// Mutable Event Payloads (for hooks that can modify data in the pipeline)
// ---------------------------------------------------------------------------

/**
 * Mutable payload for the llm:before-request hook.
 *
 * Handlers can modify `messages` and `tools` to influence the LLM request.
 * All other fields are readonly -- model, temperature, etc. are controlled
 * by config, not plugins.
 */
export interface MutableBeforeLLMRequestPayload {
  readonly sessionId: string;
  /** The messages array -- handlers may add, remove, or modify entries */
  messages: Array<{
    role: string;
    content: string | unknown[];
  }>;
  /** Tool definitions -- handlers may add or remove tools */
  tools:
    | Array<{
        name: string;
        description: string;
      }>
    | undefined;
  readonly stream: boolean;
  readonly options: Readonly<Record<string, unknown>> | undefined;
  readonly timestamp: string;
}

/**
 * Mutable payload for the response:before-send hook.
 *
 * Handlers can modify `text` (e.g. append disclaimers, transform formatting).
 * Channel, session, and other routing fields are immutable.
 */
export interface MutableBeforeResponseSentPayload {
  readonly sessionId: string;
  readonly channel: string;
  readonly conversationId: string;
  /** Text content -- handlers may modify this (append, transform, etc.) */
  text: string;
  readonly format: 'plain' | 'markdown' | undefined;
  readonly replyToMessageId: string | undefined;
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------
// Mutable Payload Map
// ---------------------------------------------------------------------------

/**
 * Maps mutable hook event names to their mutable payload types.
 * Only events that support modification are included here.
 */
export interface MutableHookPayloadMap {
  'llm:before-request': MutableBeforeLLMRequestPayload;
  'response:before-send': MutableBeforeResponseSentPayload;
}

/**
 * Union of event names that support mutable payloads.
 */
export type MutableHookEvent = keyof MutableHookPayloadMap;

// ---------------------------------------------------------------------------
// Hook Event Map
// ---------------------------------------------------------------------------

/**
 * Maps each hook event name to its payload type.
 * This is the central type that drives type safety for the entire hook system.
 */
export interface HookPayloadMap {
  'message:received': MessageReceivedEvent;
  'llm:before-request': BeforeLLMRequestEvent;
  'llm:after-response': AfterLLMResponseEvent;
  'tool:before-call': ToolCallEvent;
  'tool:after-call': AfterToolCallEvent;
  'response:before-send': BeforeResponseSentEvent;
  'session:created': SessionCreatedEvent;
  'session:destroyed': SessionDestroyedEvent;
  'gateway:startup': StartupEvent;
  'gateway:shutdown': ShutdownEvent;
}

/**
 * Union of all valid hook event names.
 */
export type HookEvent = keyof HookPayloadMap;

/**
 * Type-safe handler for a specific hook event (observe-only).
 * Handlers receive the event payload and must return a Promise.
 * Handlers must not throw -- but if they do, the error will be caught
 * and logged by the HookRegistry.
 */
export type HookHandler<E extends HookEvent> = (payload: HookPayloadMap[E]) => Promise<void>;

/**
 * Type-safe handler for a mutable hook event.
 * Handlers receive a mutable payload, modify it in place, and return void.
 * Handlers run sequentially so each sees the previous handler's modifications.
 */
export type MutableHookHandler<E extends MutableHookEvent> = (
  payload: MutableHookPayloadMap[E]
) => Promise<void>;

// ---------------------------------------------------------------------------
// Hook Stats Types (for failure observability)
// ---------------------------------------------------------------------------

/**
 * Per-event statistics tracking success/failure counts and last failure details.
 */
export interface HookEventStats {
  successCount: number;
  failureCount: number;
  lastFailure?: { error: string; label: string; timestamp: string };
  timeoutCount: number;
}

/**
 * Aggregated statistics across all hook events.
 */
export interface HookStats {
  events: Record<string, HookEventStats>;
  totalEmits: number;
  totalFailures: number;
}

/**
 * Internal registration record used by HookRegistry.
 */
export interface HookRegistration<E extends HookEvent> {
  /** The handler function */
  readonly handler: HookHandler<E>;
  /** Execution priority (lower = earlier). Default is 100. */
  readonly priority: number;
  /** Optional label for logging and debugging */
  readonly label?: string;
}

/**
 * Internal registration record for mutable hook handlers.
 */
export interface MutableHookRegistration<E extends MutableHookEvent> {
  /** The handler function */
  readonly handler: MutableHookHandler<E>;
  /** Execution priority (lower = earlier). Default is 100. */
  readonly priority: number;
  /** Optional label for logging and debugging */
  readonly label?: string;
}
