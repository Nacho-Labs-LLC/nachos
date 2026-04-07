// Shared types for Nachos
// NOTE: Config types (NachosConfig, LLMConfig, etc.) should be imported
// directly from '@nachos/config', not from this package.

// ============================================================================
// Structured Logger
// ============================================================================

export { createLogger, type Logger } from './logger.js';

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
  type ToolSandboxConfig,
  type Tool,
  type ToolCall,
  type ToolManifest,
  type SessionsSpawnToolParameters,
  type SessionsSpawnToolResult,
  type ExecutionOptions,
  type ChainResult,
  type ChainContext,
  type RecoveryAction,
  type RecoveryResult,
} from './tool-types.js';

// ============================================================================
// State Layer Types
// ============================================================================

export {
  type IdentitySource,
  type IdentityProfile,
  type BootstrapBlockMap,
  type BootstrapProfile,
  type MemoryKind,
  type MemoryEntry,
  type MemoryFact,
  type MemoryFactType,
  type MemoryQuery,
  type MemoryQueryResult,
  type IdentityStore,
  type MemoryStore,
  type BootstrapStore,
  type UserProfile,
  type UserProfileStore,
  type WorkspaceDocument,
  type DocumentChunk,
  type WorkspaceDocumentQuery,
  type WorkspaceDocumentStore,
  type SessionStateRecord,
  type SessionStateStore,
  type PromptSectionReport,
  type PromptReport,
  type PromptAssemblyResult,
  MAX_SESSION_STATE_SIZE_BYTES,
} from './state-types.js';

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
  ChannelCommandRequestSchema,
  type ChannelCommandRequestType,
  ChannelCommandResponseSchema,
  type ChannelCommandResponseType,
  ConfigUpdateRequestSchema,
  type ConfigUpdateRequestType,
  ConfigUpdateResponseSchema,
  type ConfigUpdateResponseType,
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
  SessionsSpawnToolSchema,
  type SessionsSpawnToolType,
  SessionsOrchestrateToolSchema,
  type SessionsOrchestrateToolType,
  SubagentsToolSchema,
  type SubagentsToolType,
  SubagentProgressToolSchema,
  type SubagentProgressToolType,
  MemoryToolSchema,
  type MemoryToolType,
  BootstrapToolSchema,
  type BootstrapToolType,
  UserProfileToolSchema,
  type UserProfileToolType,

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
  validateChannelCommandRequest,
  validateChannelCommandResponse,
  validateConfigUpdateRequest,
  validateConfigUpdateResponse,
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
// Channel Adapter Types
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

// ============================================================================
// Legacy Type Aliases (backed by TypeBox schemas)
//
// These aliases preserve the old short names (e.g. `Session`, `Message`) so
// existing imports continue to work. They resolve to the TypeBox-derived
// `Static<>` types, giving both compile-time and runtime type safety.
// ============================================================================

export type {
  MessageEnvelopeType as MessageEnvelope,
  AttachmentType as Attachment,
  SenderType as Sender,
  ConversationType as Conversation,
  MessageContentType as MessageContent,
  ChannelInboundMessageType as ChannelInboundMessage,
  ChannelOutboundMessageType as ChannelOutboundMessage,
  SessionStatusType as SessionStatus,
  MessageRoleType as MessageRole,
  MessageType as Message,
  SessionConfigType as SessionConfig,
  SessionType as Session,
  SessionWithMessagesType as SessionWithMessages,
  LLMMessageType as LLMMessage,
  LLMRequestType as LLMRequest,
  ToolRequestType as ToolRequest,
  ToolResponseType as ToolResponse,
  HealthStatusType as HealthStatus,
  HealthCheckType as HealthCheck,
} from './schemas.js';
