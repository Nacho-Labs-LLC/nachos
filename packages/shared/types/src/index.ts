// Shared types for Nachos

// Re-export configuration types from @nachos/config
export type {
  NachosConfig,
  PartialNachosConfig,
  NachosSection,
  LLMConfig,
  ChannelsConfig,
  ToolsConfig,
  SecurityConfig,
  RuntimeConfig,
  AssistantConfig,
} from '@nachos/config';

// ============================================================================
// Tool Types (Phase 6)
// ============================================================================

export {
  SecurityTier,
  type ContentBlock,
  type TextContentBlock,
  type ImageContentBlock,
  type FileContentBlock,
  type ToolResult,
  type ToolParameters,
  type ValidationResult as ToolValidationResult,
  type HealthStatus as ToolHealthStatus,
  type ParameterSchema,
  type JSONSchemaProperty,
  type ToolConfig,
  type Tool,
  type ToolCall,
  type ToolManifest,
  type ExecutionOptions,
  type ChainResult,
  type ChainContext,
  type RecoveryAction,
  type RecoveryResult,
} from './tool-types.js';

/**
 * @nachos/types - Shared TypeScript types and schemas for Nachos
 *
 * This package provides:
 * - TypeBox schemas for runtime validation
 * - TypeScript interfaces for compile-time type safety
 * - Validation middleware for message handling
 * - Error types and factory functions
 *
 * @example
 * ```typescript
 * import {
 *   MessageEnvelope,
 *   ChannelInboundMessage,
 *   validate,
 *   Schemas,
 *   createValidationError,
 * } from '@nachos/types';
 * ```
 */

// Re-export TypeBox for consumers who need to create custom schemas
export { Type, type Static, type TSchema } from '@sinclair/typebox';

// ============================================================================
// TypeBox Schemas
// ============================================================================

export {
  // Base schemas
  MessageEnvelopeSchema,
  UUIDSchema,
  TimestampSchema,
  type MessageEnvelopeType,

  // Attachment and content schemas
  AttachmentSchema,
  type AttachmentType,
  SenderSchema,
  type SenderType,
  ConversationSchema,
  ConversationTypeSchema,
  type ConversationType,
  MessageContentSchema,
  type MessageContentType,

  // Channel message schemas
  ChannelInboundMessageSchema,
  type ChannelInboundMessageType,
  ChannelOutboundMessageSchema,
  type ChannelOutboundMessageType,
  OutboundAttachmentSchema,
  OutboundContentSchema,
  OutboundOptionsSchema,

  // Session schemas
  SessionStatusSchema,
  type SessionStatusType,
  MessageRoleSchema,
  type MessageRoleType,
  MessageSchema,
  type MessageType,
  SessionConfigSchema,
  type SessionConfigType,
  SessionSchema,
  type SessionType,
  SessionWithMessagesSchema,
  type SessionWithMessagesType,

  // LLM schemas
  LLMMessageSchema,
  type LLMMessageType,
  LLMRequestSchema,
  type LLMRequestType,
  LLMContentPartSchema,
  LLMToolDefinitionSchema,
  LLMRequestOptionsSchema,
  LLMToolCallSchema,
  type LLMToolCallType,
  LLMUsageSchema,
  type LLMUsageType,
  LLMErrorSchema,
  type LLMErrorType,
  LLMResponseSchema,
  type LLMResponseType,
  LLMStreamChunkSchema,
  type LLMStreamChunkType,

  // Tool schemas
  ToolRequestSchema,
  type ToolRequestType,
  ToolResponseSchema,
  type ToolResponseType,
  ToolErrorSchema,

  // Health schemas
  HealthStatusSchema,
  type HealthStatusType,
  HealthCheckSchema,
  type HealthCheckType,

  // Error schemas
  ErrorCodeSchema,
  type ErrorCodeType,
  NachosErrorSchema,
  type NachosErrorType,

  // Policy schemas
  PolicyCheckRequestSchema,
  type PolicyCheckRequestType,
  PolicyCheckResultSchema,
  type PolicyCheckResultType,

  // Audit schemas
  AuditLogEntrySchema,
  type AuditLogEntryType,

  // Schema collection
  Schemas,
} from './schemas.js';

// ============================================================================
// Context Management Event Schemas
// ============================================================================

export {
  // Compaction event
  CompactionEventSchema,
  type CompactionEvent,

  // Extraction event
  ExtractionEventSchema,
  type ExtractionEvent,

  // Zone change event
  ZoneChangeEventSchema,
  type ZoneChangeEvent,

  // Snapshot event
  SnapshotEventSchema,
  type SnapshotEvent,

  // Budget update event
  BudgetUpdateEventSchema,
  type BudgetUpdateEvent,

  // Schema collection
  ContextEventSchemas,
} from './context-events.js';

// ============================================================================
// Validation Middleware
// ============================================================================

export {
  // Core validation functions
  validate,
  validateOrThrow,
  isValid,
  clean,
  applyDefaults,

  // Pre-compiled validators
  validateMessageEnvelope,
  validateChannelInboundMessage,
  validateChannelOutboundMessage,
  validateLLMRequest,
  validateLLMResponse,
  validateLLMStreamChunk,
  validateToolRequest,
  validateToolResponse,
  validatePolicyCheckRequest,
  validatePolicyCheckResult,
  validateAuditLogEntry,
  validateHealthCheck,
  validateNachosError,
  validateSession,
  validateMessage,

  // Middleware
  createValidatedHandler,
  withValidation,

  // Types
  type ValidationError,
  type ValidationResult,
  type ValidationMiddlewareOptions,
  type ValidatedMessageHandler,
} from './validation.js';

// ============================================================================
// Error Types and Factories
// ============================================================================

export {
  // Error codes
  NachosErrorCodes,
  type NachosErrorCode,

  // Error class
  NachosError,
  type NachosErrorData,

  // Factory functions
  createConfigError,
  createPolicyDeniedError,
  createRateLimitedError,
  createLLMFailedError,
  createToolFailedError,
  createChannelFailedError,
  createSessionNotFoundError,
  createTimeoutError,
  createInternalError,
  createValidationError,
  createBusConnectionError,
  createInvalidMessageError,
  createAuthFailedError,
  createPermissionDeniedError,
  createNotFoundError,
  createAlreadyExistsError,
  createInvalidStateError,

  // Utilities
  isNachosError,
  hasErrorCode,
  wrapError,
  extractErrorInfo,

  // Options type
  type CreateErrorOptions,
} from './errors.js';

// ============================================================================
// Legacy Interface Types (for backwards compatibility)
// ============================================================================

export type {
  ChannelAdapter,
  ChannelAdapterConfig,
  ChannelBus,
  ChannelDMPolicy,
  ChannelGroupPolicy,
  SendResult,
  InboundMessage,
  OutboundMessage,
} from './channel.js';

// NOTE: These interfaces are maintained for backwards compatibility.
// For new code, prefer using the TypeBox schema types (e.g., MessageEnvelopeType)
// which provide both compile-time and runtime type safety.

// NachosConfig is already exported from @nachos/config (line 5)

/**
 * Base message envelope for all inter-component communication
 * @deprecated Use MessageEnvelopeType from schemas.js for type safety
 */
export interface MessageEnvelope {
  id: string;
  timestamp: string;
  source: string;
  type: string;
  correlationId?: string;
  payload: unknown;
}

/**
 * Attachment structure for messages
 * @deprecated Use AttachmentType from schemas.js for type safety
 */
export interface Attachment {
  type: string;
  url: string;
  name?: string;
  mimeType?: string;
  size?: number;
}

/**
 * Sender information in channel messages
 * @deprecated Use SenderType from schemas.js for type safety
 */
export interface Sender {
  id: string;
  name?: string;
  isAllowed: boolean;
}

/**
 * Conversation context
 * @deprecated Use ConversationType from schemas.js for type safety
 */
export interface Conversation {
  id: string;
  type: 'dm' | 'channel' | 'thread';
}

/**
 * Content structure for messages
 * @deprecated Use MessageContentType from schemas.js for type safety
 */
export interface MessageContent {
  text?: string;
  attachments?: Attachment[];
}

/**
 * Inbound message from channels
 * @deprecated Use ChannelInboundMessageType from schemas.js for type safety
 */
export interface ChannelInboundMessage {
  channel: string;
  channelMessageId: string;
  sessionId?: string;
  sender: Sender;
  conversation: Conversation;
  content: MessageContent;
  metadata?: Record<string, unknown>;
}

/**
 * Outbound message to channels
 * @deprecated Use ChannelOutboundMessageType from schemas.js for type safety
 */
export interface ChannelOutboundMessage {
  channel: string;
  conversationId: string;
  sessionId?: string;
  replyToMessageId?: string;
  content: {
    text: string;
    format?: 'plain' | 'markdown';
    attachments?: Array<{
      type: string;
      data: string | unknown;
      name?: string;
    }>;
  };
  options?: {
    ephemeral?: boolean;
    threadReply?: boolean;
  };
}

// ============================================================================
// Session Types (Legacy)
// ============================================================================

/**
 * Session status
 * @deprecated Use SessionStatusType from schemas.js for type safety
 */
export type SessionStatus = 'active' | 'paused' | 'ended';

/**
 * Message role in conversation
 * @deprecated Use MessageRoleType from schemas.js for type safety
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Message in conversation history
 * @deprecated Use MessageType from schemas.js for type safety
 */
export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  toolCalls?: unknown;
  createdAt: string;
}

/**
 * Session configuration
 * @deprecated Use SessionConfigType from schemas.js for type safety
 */
export interface SessionConfig {
  model?: string;
  maxTokens?: number;
  tools?: string[];
}

/**
 * Session data structure
 * @deprecated Use SessionType from schemas.js for type safety
 */
export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  channel: string;
  conversationId: string;
  userId: string;
  status: SessionStatus;
  systemPrompt?: string;
  config: SessionConfig;
  metadata: Record<string, unknown>;
}

/**
 * Session with messages (for read operations)
 * @deprecated Use SessionWithMessagesType from schemas.js for type safety
 */
export interface SessionWithMessages extends Session {
  messages: Message[];
}

// ============================================================================
// LLM Types (Legacy)
// ============================================================================

/**
 * LLM message structure
 * @deprecated Use LLMMessageType from schemas.js for type safety
 */
export interface LLMMessage {
  role: MessageRole;
  content:
    | string
    | Array<{
        type: string;
        text?: string;
        image_url?: string;
        tool_use_id?: string;
        tool_result?: unknown;
      }>;
  name?: string;
  tool_call_id?: string;
}

/**
 * LLM request structure
 * @deprecated Use LLMRequestType from schemas.js for type safety
 */
export interface LLMRequest {
  sessionId: string;
  messages: LLMMessage[];
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  options?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    stream?: boolean;
  };
}

// ============================================================================
// Tool Types (Legacy)
// ============================================================================

/**
 * Tool execution request
 * @deprecated Use ToolRequestType from schemas.js for type safety
 */
export interface ToolRequest {
  sessionId: string;
  tool: string;
  callId: string;
  parameters: Record<string, unknown>;
}

/**
 * Tool execution response
 * @deprecated Use ToolResponseType from schemas.js for type safety
 */
export interface ToolResponse {
  sessionId: string;
  callId: string;
  success: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

// ============================================================================
// Health Check Types (Legacy)
// ============================================================================

/**
 * Health status
 * @deprecated Use HealthStatusType from schemas.js for type safety
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Health check result
 * @deprecated Use HealthCheckType from schemas.js for type safety
 */
export interface HealthCheck {
  status: HealthStatus;
  component: string;
  version: string;
  uptime: number;
  checks: Record<string, 'ok' | 'error'>;
}

// ============================================================================
// Error Types (Legacy - for backwards compatibility)
// ============================================================================

/**
 * Legacy error codes
 * @deprecated Use NachosErrorCodes from errors.js for more comprehensive error codes
 */
export const ErrorCodes = {
  CONFIG: 'NACHOS_ERR_CONFIG',
  POLICY_DENIED: 'NACHOS_ERR_POLICY_DENIED',
  RATE_LIMITED: 'NACHOS_ERR_RATE_LIMITED',
  LLM_FAILED: 'NACHOS_ERR_LLM_FAILED',
  TOOL_FAILED: 'NACHOS_ERR_TOOL_FAILED',
  CHANNEL_FAILED: 'NACHOS_ERR_CHANNEL_FAILED',
  SESSION_NOT_FOUND: 'NACHOS_ERR_SESSION_NOT_FOUND',
  TIMEOUT: 'NACHOS_ERR_TIMEOUT',
  INTERNAL: 'NACHOS_ERR_INTERNAL',
} as const;
