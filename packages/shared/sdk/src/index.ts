/**
 * @nachos/sdk - Developer SDK for building Nachos channels and tools
 *
 * This package provides the interfaces and types needed to create custom
 * channel adapters and tool containers for the Nachos platform.
 *
 * ## Quick Start
 *
 * ### Building a Channel
 *
 * ```typescript
 * import type { NachosChannel, NachosChannelConfig, OutboundMessage, SendResult } from '@nachos/sdk';
 * import { CHANNEL_TOPICS, STATUS_TOPICS } from '@nachos/sdk';
 *
 * export class MyChannel implements NachosChannel {
 *   readonly channelId = 'my-platform';
 *   readonly name = 'My Platform';
 *
 *   async initialize(config: NachosChannelConfig): Promise<void> { ... }
 *   async start(): Promise<void> { ... }
 *   async stop(): Promise<void> { ... }
 *   async sendMessage(message: OutboundMessage): Promise<SendResult> { ... }
 *   async sendTypingIndicator(conversationId: string): Promise<void> { ... }
 *   async healthCheck(): Promise<'healthy' | 'degraded' | 'unhealthy'> { ... }
 * }
 * ```
 *
 * ### Building a Tool
 *
 * ```typescript
 * import type { NachosTool, NachosToolConfig, ToolExecutionContext, ToolResult } from '@nachos/sdk';
 * import { SecurityTier, TOOL_TOPICS } from '@nachos/sdk';
 *
 * export class MyTool implements NachosTool {
 *   readonly toolId = 'my_tool';
 *   readonly name = 'My Tool';
 *   readonly description = 'Does something useful';
 *   readonly securityTier = SecurityTier.SAFE;
 *   readonly parameters = { type: 'object' as const, properties: { ... } };
 *
 *   async initialize(config: NachosToolConfig): Promise<void> { ... }
 *   async execute(params, context): Promise<ToolResult> { ... }
 *   validate(params): { valid: boolean; errors?: string[] } { ... }
 *   async healthCheck(): Promise<{ healthy: boolean; error?: string }> { ... }
 * }
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// Shared Types
// ============================================================================

export {
  SecurityTier,
  type SecurityMode,
  type SendResult,
  type HealthStatus,
  type InboundMessage,
  type OutboundMessage,
  type ToolResult,
  type ContentBlock,
  type TextContentBlock,
  type ImageContentBlock,
  type FileContentBlock,
  type JSONSchemaProperty,
  type ParameterSchema,
} from './types.js';

// ============================================================================
// Runtime Context
// ============================================================================

export type { NachosContext, PluginBus, PluginLogger } from './context.js';

// ============================================================================
// Channel Interface
// ============================================================================

export {
  CHANNEL_TOPICS,
  STATUS_TOPICS,
  AUDIT_TOPIC,
  type NachosChannel,
  type NachosChannelConfig,
} from './channel.js';

// ============================================================================
// Tool Interface
// ============================================================================

export {
  TOOL_TOPICS,
  type NachosTool,
  type NachosToolConfig,
  type ToolExecutionContext,
  type ToolValidationResult,
  type ToolHealthResult,
} from './tool.js';

// ============================================================================
// Base Classes (runtime helpers)
// ============================================================================

export { BaseChannel, type StatusEventType } from './base-channel.js';
export { BaseTool, type BaseToolOptions, type BaseToolConfig } from './base-tool.js';

// ============================================================================
// Plugin Manifest
// ============================================================================

export type {
  NachosPluginManifest,
  ChannelManifest,
  ToolManifest,
  NetworkCapabilities,
  ResourceCapabilities,
  ChannelProvides,
  ToolProvides,
  PluginConfigSchema,
} from './manifest.js';
