/**
 * @nachos/sdk - Shared Types
 *
 * Types that plugin authors need when building channels and tools.
 * These are SDK-specific types that complement those from @nachos/types.
 */

/**
 * Security mode that Nachos is running under.
 * Determines default behavior for tool availability, DM access, and audit depth.
 *
 * - `strict`: All tools disabled by default, allowlist DMs only, full audit logging.
 * - `standard`: Common tools enabled, pairing-based DMs, standard audit logging.
 * - `permissive`: Full access to tools, open DMs (requires explicit opt-in).
 */
export type SecurityMode = 'strict' | 'standard' | 'permissive';

/**
 * Result of sending a message through a channel.
 */
export interface SendResult {
  /** Whether the message was sent successfully. */
  success: boolean;
  /** Platform-specific message identifier, available on success. */
  messageId?: string;
  /** Error details, populated when `success` is false. */
  error?: {
    /** Machine-readable error code (e.g. 'slack_error', 'rate_limited'). */
    code: string;
    /** Human-readable error description. */
    message: string;
    /** Whether the caller should retry this operation. */
    retryable: boolean;
  };
}

/**
 * Health status values used by both channels and tools.
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * An inbound message from a user, normalized across all platforms.
 * This is what channels publish to the bus when a user sends a message.
 */
export interface InboundMessage {
  /** Channel identifier (e.g. 'slack', 'discord', 'telegram'). */
  channel: string;
  /** Message ID from the originating platform. */
  channelMessageId: string;
  /** Existing session ID, if resuming a prior conversation. */
  sessionId?: string;
  /** Information about the message sender. */
  sender: {
    /** Platform-specific user identifier. */
    id: string;
    /** Display name, if available from the platform. */
    name?: string;
    /** Whether this sender has passed allowlist/pairing checks. */
    isAllowed: boolean;
  };
  /** Conversation context. */
  conversation: {
    /** Platform-specific conversation identifier. */
    id: string;
    /** Conversation type. */
    type: 'dm' | 'channel' | 'thread';
  };
  /** Message content. */
  content: {
    /** Text body of the message. */
    text?: string;
    /** File or media attachments. */
    attachments?: Array<{
      /** Attachment type (e.g. 'image', 'file', 'video'). */
      type: string;
      /** URL to the attachment. */
      url: string;
      /** Original filename. */
      name?: string;
      /** MIME type. */
      mimeType?: string;
      /** Size in bytes. */
      size?: number;
    }>;
  };
  /** Channel-specific metadata (e.g. teamId, guildId, chatType). */
  metadata?: Record<string, unknown>;
}

/**
 * An outbound message from the assistant, sent to a user through a channel.
 * This is what channels receive from the bus to deliver to the user.
 */
export interface OutboundMessage {
  /** Target channel identifier. */
  channel: string;
  /** Conversation to deliver the message to. */
  conversationId: string;
  /** Session identifier for this message. */
  sessionId?: string;
  /** Platform message ID to reply to (for threading). */
  replyToMessageId?: string;
  /** Message content to send. */
  content: {
    /** Text body of the message. */
    text: string;
    /** Text format hint. */
    format?: 'plain' | 'markdown';
    /** Outbound attachments (binary data or URLs). */
    attachments?: Array<{
      /** Attachment type. */
      type: string;
      /** Attachment data (base64 string, URL, or raw bytes). */
      data: string | unknown;
      /** Filename for the attachment. */
      name?: string;
    }>;
  };
  /** Delivery options. */
  options?: {
    /** Whether the message is only visible to the recipient. */
    ephemeral?: boolean;
    /** Whether to reply in a thread. */
    threadReply?: boolean;
  };
}

/**
 * Security tier for tools (0-4).
 * Determines the level of scrutiny and approval required before execution.
 */
export enum SecurityTier {
  /** Safe operations with no side effects (e.g. read files, search). */
  SAFE = 0,
  /** Standard operations with limited access (e.g. browser navigation). */
  STANDARD = 1,
  /** Elevated operations with write access (e.g. write files). */
  ELEVATED = 2,
  /** Restricted operations requiring explicit approval (e.g. code execution). */
  RESTRICTED = 3,
  /** Dangerous operations (typically blocked in strict/standard modes). */
  DANGEROUS = 4,
}

/**
 * Result returned from a tool execution.
 */
export interface ToolResult {
  /** Whether the execution succeeded. */
  success: boolean;
  /** Result content blocks. A tool can return text, images, or file references. */
  content: ContentBlock[];
  /** Execution metadata. */
  metadata?: {
    /** Execution duration in milliseconds. */
    duration: number;
    /** Whether the result was served from cache. */
    cached?: boolean;
    /** Non-fatal warnings encountered during execution. */
    warnings?: string[];
  };
  /** Error information, populated when `success` is false. */
  error?: {
    /** Machine-readable error code. */
    code: string;
    /** Human-readable error description. */
    message: string;
    /** Additional error details for debugging. */
    details?: unknown;
  };
}

/**
 * A content block in a tool result.
 * Tools can return multiple blocks of different types in a single response.
 */
export type ContentBlock = TextContentBlock | ImageContentBlock | FileContentBlock;

/**
 * A text content block.
 */
export interface TextContentBlock {
  type: 'text';
  /** The text content. */
  text: string;
}

/**
 * An image content block.
 */
export interface ImageContentBlock {
  type: 'image';
  /** Base64-encoded image data or a URL. */
  data: string;
  /** MIME type of the image (e.g. 'image/png'). */
  mimeType: string;
  /** How the `data` field should be interpreted. */
  source?: 'base64' | 'url';
}

/**
 * A file content block.
 */
export interface FileContentBlock {
  type: 'file';
  /** Path to the file. */
  path: string;
  /** MIME type of the file. */
  mimeType?: string;
  /** File size in bytes. */
  size?: number;
}

/**
 * JSON Schema property definition for tool parameters.
 */
export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: unknown[];
  format?: string;
  examples?: unknown[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

/**
 * JSON Schema for tool parameters.
 * Tools declare their accepted parameters using this schema, which is provided
 * to the LLM so it knows how to call the tool.
 */
export interface ParameterSchema {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}
