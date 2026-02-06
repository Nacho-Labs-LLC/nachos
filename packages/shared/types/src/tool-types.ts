/**
 * Tool Types
 *
 * Core types and interfaces for the NACHOS tool system.
 * Follows the tool interface specification from docs/api/tool-interface.md
 */

/**
 * Security tier for tools (0-4)
 * Determines the level of scrutiny and approval required
 */
export enum SecurityTier {
  /** Safe operations with no side effects (e.g., read files, search) */
  SAFE = 0,
  /** Standard operations with limited access (e.g., browser navigation) */
  STANDARD = 1,
  /** Elevated operations with write access (e.g., write files) */
  ELEVATED = 2,
  /** Restricted operations requiring explicit approval (e.g., code execution) */
  RESTRICTED = 3,
  /** Dangerous operations (typically blocked) */
  DANGEROUS = 4,
}

/**
 * Content block types for tool results
 * Adopted from OpenClaw for rich media support
 */
export type ContentBlock =
  | TextContentBlock
  | ImageContentBlock
  | FileContentBlock;

export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ImageContentBlock {
  type: 'image';
  /** Base64-encoded image data or URL */
  data: string;
  mimeType: string;
  /** Source type for the image data */
  source?: 'base64' | 'url';
}

export interface FileContentBlock {
  type: 'file';
  /** Path to the file */
  path: string;
  mimeType?: string;
  size?: number;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  /** Whether execution succeeded */
  success: boolean;

  /** Result content (can include multiple blocks) */
  content: ContentBlock[];

  /** Execution metadata */
  metadata?: {
    /** Execution duration in milliseconds */
    duration: number;
    /** Whether the result was served from cache */
    cached?: boolean;
    /** Non-fatal warnings */
    warnings?: string[];
  };

  /** Error information (if failed) */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Tool execution parameters
 */
export interface ToolParameters {
  /** Session ID for context */
  sessionId: string;

  /** Unique call ID for this execution */
  callId: string;

  /** Tool-specific parameters */
  [key: string]: unknown;
}

/**
 * Validation result from parameter validation
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Health status for a tool
 */
export interface HealthStatus {
  healthy: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * Parameter schema (JSON Schema format)
 */
export interface ParameterSchema {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * JSON Schema property definition
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
 * Tool configuration passed to initialize()
 */
export interface ToolConfig {
  /** Configuration from nachos.toml */
  config: Record<string, unknown>;

  /** Environment variables (secrets) */
  secrets: Record<string, string>;

  /** Security mode */
  securityMode: 'strict' | 'standard' | 'permissive';

  /** Sandbox configuration (if supported by tool runtime) */
  sandbox?: ToolSandboxConfig;

  /** Tool-specific limits */
  limits?: {
    timeout?: number;
    maxMemory?: number;
    maxConcurrent?: number;
  };
}

/**
 * Sandbox configuration for tool execution
 */
export interface ToolSandboxConfig {
  /** Enable or disable sandboxing */
  enabled?: boolean;

  /** Sandbox provider or runtime */
  provider?: 'docker' | 'native' | 'none';

  /** Workspace directory inside sandbox */
  workspaceDir?: string;

  /** Network access policy */
  network?: 'none' | 'egress' | 'full';
}

/**
 * Base tool interface
 * All tools must implement this interface
 */
export interface Tool {
  /** Unique identifier for this tool */
  readonly toolId: string;

  /** Display name for this tool */
  readonly name: string;

  /** Tool description for LLM */
  readonly description: string;

  /** Security tier (0-4) */
  readonly securityTier: SecurityTier;

  /** Parameter schema (JSON Schema) */
  readonly parameters: ParameterSchema;

  /** Initialize the tool */
  initialize(config: ToolConfig): Promise<void>;

  /** Execute the tool */
  execute(params: ToolParameters): Promise<ToolResult>;

  /** Validate parameters before execution */
  validate(params: ToolParameters): ValidationResult;

  /** Health check */
  healthCheck(): Promise<HealthStatus>;
}

/**
 * Tool call information
 * Used by coordinator for orchestration
 */
export interface ToolCall {
  /** Unique ID for this call */
  id: string;

  /** Tool identifier */
  tool: string;

  /** Session ID */
  sessionId: string;

  /** Tool parameters */
  parameters: Record<string, unknown>;

  /** Security tier (for policy checks) */
  securityTier?: SecurityTier;

  /** Execution timeout in milliseconds */
  timeout?: number;

  /** Cache TTL in seconds */
  cacheTTL?: number;
}

/**
 * Tool manifest schema
 * Defines tool capabilities and requirements
 */
export interface ToolManifest {
  name: string;
  version: string;
  type: 'tool';
  capabilities: {
    network?: {
      egress?: string[];
    };
    resources?: {
      memory?: string;
      cpus?: number;
    };
  };
  provides: {
    tool: string;
    securityTier: SecurityTier;
  };
}

/**
 * Tool execution options
 */
export interface ExecutionOptions {
  /** Force parallel execution (if safe) */
  forceParallel?: boolean;

  /** Bypass cache */
  bypassCache?: boolean;

  /** Custom timeout override */
  timeout?: number;
}

/**
 * Chain execution result
 */
export interface ChainResult {
  success: boolean;
  results: ToolResult[];
  failedAt?: number;
}

/**
 * Chain context for variable substitution
 */
export interface ChainContext {
  previous?: {
    result?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Error recovery action
 */
export type RecoveryAction = 'retry' | 'fallback' | 'report';

/**
 * Recovery result from error handler
 */
export interface RecoveryResult {
  action: RecoveryAction;
  maxRetries?: number;
  backoff?: number;
  tool?: string;
  message?: string;
}
