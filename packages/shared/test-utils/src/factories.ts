/**
 * Test Data Factories
 *
 * Provides factory functions for creating valid Nachos domain objects
 * with sensible defaults. All factories accept optional partial overrides
 * to customize specific fields while keeping everything else valid.
 *
 * Pattern: `createTestX(overrides?)` returns a complete, valid X.
 *
 * @example
 * ```typescript
 * import { createTestSession, createTestMessage, createInboundMessage } from '@nachos/test-utils';
 *
 * const session = createTestSession({ channel: 'discord', userId: 'U999' });
 * const message = createTestMessage({ sessionId: session.id, role: 'user' });
 * const inbound = createInboundMessage({ channel: 'slack' });
 * ```
 */

import type {
  SessionType,
  MessageType,
  ChannelInboundMessageType,
  ChannelOutboundMessageType,
  ToolRequestType,
  ToolResponseType,
  MessageEnvelopeType,
  ToolResult,
  ToolCall,
  ContentBlock,
  TextContentBlock,
} from '@nachos/types';
import { SecurityTier } from '@nachos/types';

// ---------------------------------------------------------------------------
// Internal counter for generating unique IDs within a test run
// ---------------------------------------------------------------------------

let idCounter = 0;

/**
 * Reset the internal ID counter. Called automatically by `resetFactories()`.
 * Useful in `beforeEach` to get deterministic IDs across test cases.
 */
export function resetIdCounter(): void {
  idCounter = 0;
}

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

const DEFAULT_TIMESTAMP = '2024-01-01T00:00:00.000Z';

// ---------------------------------------------------------------------------
// Session factory
// ---------------------------------------------------------------------------

/**
 * Create a valid Session object with sensible defaults.
 * All fields can be overridden via the `overrides` parameter.
 */
export function createTestSession(overrides: Partial<SessionType> = {}): SessionType {
  const id = overrides.id ?? nextId('session');
  const now = overrides.createdAt ?? DEFAULT_TIMESTAMP;
  return {
    id,
    createdAt: now,
    updatedAt: overrides.updatedAt ?? now,
    channel: overrides.channel ?? 'slack',
    conversationId: overrides.conversationId ?? nextId('conv'),
    userId: overrides.userId ?? nextId('user'),
    status: overrides.status ?? 'active',
    systemPrompt: overrides.systemPrompt,
    config: overrides.config ?? {},
    metadata: overrides.metadata ?? {},
    isPinned: overrides.isPinned ?? false,
    isArchived: overrides.isArchived ?? false,
    lastActivity: overrides.lastActivity ?? now,
  };
}

// ---------------------------------------------------------------------------
// Message factory
// ---------------------------------------------------------------------------

/**
 * Create a valid conversation Message object.
 */
export function createTestMessage(overrides: Partial<MessageType> = {}): MessageType {
  return {
    id: overrides.id ?? nextId('msg'),
    sessionId: overrides.sessionId ?? nextId('session'),
    role: overrides.role ?? 'user',
    content: overrides.content ?? 'Hello, Nachos!',
    toolCalls: overrides.toolCalls,
    createdAt: overrides.createdAt ?? DEFAULT_TIMESTAMP,
  };
}

// ---------------------------------------------------------------------------
// Channel inbound message factory
// ---------------------------------------------------------------------------

/**
 * Create a valid ChannelInboundMessage (user -> gateway via bus).
 */
export function createInboundMessage(
  overrides: Partial<ChannelInboundMessageType> = {}
): ChannelInboundMessageType {
  return {
    channel: overrides.channel ?? 'slack',
    channelMessageId: overrides.channelMessageId ?? nextId('cmsg'),
    sessionId: overrides.sessionId,
    sender: overrides.sender ?? {
      id: nextId('sender'),
      name: 'Test User',
      isAllowed: true,
    },
    conversation: overrides.conversation ?? {
      id: nextId('conv'),
      type: 'dm',
    },
    content: overrides.content ?? {
      text: 'Hello from test',
    },
    metadata: overrides.metadata,
  };
}

// ---------------------------------------------------------------------------
// Channel outbound message factory
// ---------------------------------------------------------------------------

/**
 * Create a valid ChannelOutboundMessage (gateway -> channel via bus).
 */
export function createOutboundMessage(
  overrides: Partial<ChannelOutboundMessageType> = {}
): ChannelOutboundMessageType {
  return {
    channel: overrides.channel ?? 'slack',
    conversationId: overrides.conversationId ?? nextId('conv'),
    sessionId: overrides.sessionId,
    replyToMessageId: overrides.replyToMessageId,
    content: overrides.content ?? {
      text: 'Response from assistant',
    },
    options: overrides.options,
  };
}

// ---------------------------------------------------------------------------
// Tool request factory
// ---------------------------------------------------------------------------

/**
 * Create a valid ToolRequest (gateway -> tool container via bus).
 */
export function createToolRequest(overrides: Partial<ToolRequestType> = {}): ToolRequestType {
  return {
    sessionId: overrides.sessionId ?? nextId('session'),
    tool: overrides.tool ?? 'web_fetch',
    callId: overrides.callId ?? nextId('call'),
    parameters: overrides.parameters ?? {},
  };
}

// ---------------------------------------------------------------------------
// Tool response factory
// ---------------------------------------------------------------------------

/**
 * Create a valid ToolResponse (tool container -> gateway via bus).
 */
export function createToolResponse(overrides: Partial<ToolResponseType> = {}): ToolResponseType {
  return {
    sessionId: overrides.sessionId ?? nextId('session'),
    callId: overrides.callId ?? nextId('call'),
    success: overrides.success ?? true,
    result: overrides.result ?? 'tool result data',
    error: overrides.error,
  };
}

// ---------------------------------------------------------------------------
// ToolResult factory (internal tool execution result)
// ---------------------------------------------------------------------------

/**
 * Create a valid ToolResult as returned by the tool execution engine.
 */
export function createToolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    success: overrides.success ?? true,
    content: overrides.content ?? [{ type: 'text', text: 'result' } as TextContentBlock],
    metadata: overrides.metadata,
    error: overrides.error,
  };
}

// ---------------------------------------------------------------------------
// ToolCall factory (coordinator input)
// ---------------------------------------------------------------------------

/**
 * Create a valid ToolCall as consumed by the ToolCoordinator.
 */
export function createToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: overrides.id ?? nextId('call'),
    tool: overrides.tool ?? 'web_fetch',
    sessionId: overrides.sessionId ?? nextId('session'),
    userId: overrides.userId ?? nextId('user'),
    parameters: overrides.parameters ?? {},
    securityTier: overrides.securityTier ?? SecurityTier.SAFE,
    securityMode: overrides.securityMode ?? 'standard',
    timeout: overrides.timeout,
    cacheTTL: overrides.cacheTTL,
    sandbox: overrides.sandbox,
    toolGroup: overrides.toolGroup,
  };
}

// ---------------------------------------------------------------------------
// MessageEnvelope factory
// ---------------------------------------------------------------------------

/**
 * Create a valid bus MessageEnvelope wrapping an arbitrary payload.
 */
export function createMessageEnvelope<T = unknown>(
  overrides: Partial<MessageEnvelopeType> & { payload?: T } = {}
): MessageEnvelopeType {
  return {
    id: overrides.id ?? nextId('env'),
    timestamp: overrides.timestamp ?? DEFAULT_TIMESTAMP,
    source: overrides.source ?? 'test-component',
    type: overrides.type ?? 'message',
    correlationId: overrides.correlationId,
    payload: overrides.payload ?? ({} as unknown),
  };
}

// ---------------------------------------------------------------------------
// Content block factories
// ---------------------------------------------------------------------------

/**
 * Create a text content block for tool results.
 */
export function createTextBlock(text: string): ContentBlock {
  return { type: 'text', text };
}

// ---------------------------------------------------------------------------
// Reset all factory state
// ---------------------------------------------------------------------------

/**
 * Reset all factory state (ID counter). Call in `beforeEach` for
 * deterministic IDs across test cases.
 */
export function resetFactories(): void {
  resetIdCounter();
}
