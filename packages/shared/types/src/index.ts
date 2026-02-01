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
// Message Schemas
// ============================================================================

/**
 * Base message envelope for all inter-component communication
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
 */
export interface Sender {
  id: string;
  name?: string;
  isAllowed: boolean;
}

/**
 * Conversation context
 */
export interface Conversation {
  id: string;
  type: 'dm' | 'channel' | 'thread';
}

/**
 * Content structure for messages
 */
export interface MessageContent {
  text?: string;
  attachments?: Attachment[];
}

/**
 * Inbound message from channels
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
 */
export interface ChannelOutboundMessage {
  channel: string;
  conversationId: string;
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
// Session Types
// ============================================================================

/**
 * Session status
 */
export type SessionStatus = 'active' | 'paused' | 'ended';

/**
 * Message role in conversation
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Message in conversation history
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
 */
export interface SessionConfig {
  model?: string;
  maxTokens?: number;
  tools?: string[];
}

/**
 * Session data structure
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
 */
export interface SessionWithMessages extends Session {
  messages: Message[];
}

// ============================================================================
// LLM Types
// ============================================================================

/**
 * LLM message structure
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
// Tool Types
// ============================================================================

/**
 * Tool execution request
 */
export interface ToolRequest {
  sessionId: string;
  tool: string;
  callId: string;
  parameters: Record<string, unknown>;
}

/**
 * Tool execution response
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
// Health Check Types
// ============================================================================

/**
 * Health status
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Health check result
 */
export interface HealthCheck {
  status: HealthStatus;
  component: string;
  version: string;
  uptime: number;
  checks: Record<string, 'ok' | 'error'>;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Nachos error structure
 */
export interface NachosError {
  code: string;
  message: string;
  component: string;
  details?: Record<string, unknown>;
  timestamp: string;
  correlationId?: string;
}

/**
 * Error codes
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
