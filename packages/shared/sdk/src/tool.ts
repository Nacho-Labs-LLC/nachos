/**
 * @nachos/sdk - Tool Interface
 *
 * Defines the NachosTool interface that all tool containers must implement.
 *
 * A tool provides a capability that the LLM can invoke during a conversation --
 * for example, reading files, fetching web pages, or executing code. Tools run
 * in isolated Docker containers and communicate with the gateway over NATS.
 *
 * @example
 * ```typescript
 * import type { NachosTool, NachosToolConfig, ToolExecutionContext, ToolResult } from '@nachos/sdk';
 * import { SecurityTier } from '@nachos/sdk';
 *
 * export class WeatherTool implements NachosTool {
 *   readonly toolId = 'weather';
 *   readonly name = 'Weather Lookup';
 *   readonly description = 'Look up current weather for a city';
 *   readonly securityTier = SecurityTier.SAFE;
 *
 *   readonly parameters = {
 *     type: 'object' as const,
 *     properties: {
 *       city: {
 *         type: 'string' as const,
 *         description: 'City name to look up weather for',
 *       },
 *     },
 *     required: ['city'],
 *   };
 *
 *   private apiKey!: string;
 *
 *   async initialize(config: NachosToolConfig): Promise<void> {
 *     this.apiKey = config.secrets['WEATHER_API_KEY'] ?? '';
 *     if (!this.apiKey) throw new Error('WEATHER_API_KEY is required');
 *   }
 *
 *   async execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
 *     const city = params['city'] as string;
 *     const weather = await fetchWeather(city, this.apiKey);
 *     return {
 *       success: true,
 *       content: [{ type: 'text', text: `Weather in ${city}: ${weather.summary}` }],
 *     };
 *   }
 *
 *   validate(params: Record<string, unknown>): { valid: boolean; errors?: string[] } {
 *     if (typeof params['city'] !== 'string' || params['city'].length === 0) {
 *       return { valid: false, errors: ['city must be a non-empty string'] };
 *     }
 *     return { valid: true };
 *   }
 *
 *   async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
 *     return { healthy: true };
 *   }
 * }
 * ```
 */

import type { SecurityTier, ParameterSchema, ToolResult, SecurityMode } from './types.js';

/**
 * Configuration passed to a tool during initialization.
 *
 * Provides access to settings from nachos.toml, environment secrets,
 * and runtime limits.
 */
export interface NachosToolConfig {
  /**
   * Tool-specific configuration from nachos.toml.
   * The structure depends on how the user configured this tool.
   */
  config: Record<string, unknown>;

  /**
   * Secret values (API keys, credentials) injected from environment variables.
   */
  secrets: Record<string, string>;

  /**
   * The security mode the platform is running under.
   * Tools should adjust their behavior accordingly -- for example, disabling
   * write operations in strict mode.
   */
  securityMode: SecurityMode;

  /**
   * Sandbox configuration, if the tool runs in a sandboxed environment.
   */
  sandbox?: {
    /** Whether sandboxing is enabled for this tool. */
    enabled?: boolean;
    /** Sandbox runtime ('docker', 'native', or 'none'). */
    provider?: 'docker' | 'native' | 'none';
    /** Workspace directory inside the sandbox. */
    workspaceDir?: string;
    /** Workspace access mode. */
    workspaceAccess?: 'none' | 'ro' | 'rw';
    /** Network access policy. */
    network?: 'none' | 'egress' | 'full';
  };

  /**
   * Resource limits for this tool's execution.
   */
  limits?: {
    /** Maximum execution time in milliseconds. */
    timeout?: number;
    /** Maximum memory in bytes. */
    maxMemory?: number;
    /** Maximum concurrent executions. */
    maxConcurrent?: number;
  };
}

/**
 * Context for a specific tool execution.
 *
 * This is passed to `execute()` for each invocation and contains
 * request-specific information like the session and call identifiers.
 */
export interface ToolExecutionContext {
  /** The session that is invoking this tool. */
  sessionId: string;

  /** A unique identifier for this specific tool call. */
  callId: string;
}

/**
 * Validation result from parameter checking.
 */
export interface ToolValidationResult {
  /** Whether the parameters are valid. */
  valid: boolean;
  /** Validation error messages, present when `valid` is false. */
  errors?: string[];
}

/**
 * Health check result for a tool.
 */
export interface ToolHealthResult {
  /** Whether the tool is operational. */
  healthy: boolean;
  /** Error description if unhealthy. */
  error?: string;
  /** Additional diagnostic details. */
  details?: Record<string, unknown>;
}

/**
 * The interface that all Nachos tools must implement.
 *
 * A tool provides a capability that the LLM can invoke. Each tool:
 * 1. Declares its name, description, parameter schema, and security tier
 * 2. Validates parameters before execution
 * 3. Executes the operation and returns a structured result
 * 4. Reports its health status
 *
 * The gateway uses the `parameters` schema to generate the tool definition
 * sent to the LLM, so the description and parameter descriptions should be
 * clear and actionable for the model.
 *
 * The lifecycle is: initialize -> (validate + execute per call) -> healthCheck
 */
export interface NachosTool {
  /**
   * Unique identifier for this tool.
   * Must match the NATS topic segment: `nachos.tool.<toolId>.request`.
   * Convention is snake_case (e.g. 'filesystem_read', 'web_fetch').
   */
  readonly toolId: string;

  /**
   * Human-readable display name for this tool.
   * Shown in admin UI and logs.
   */
  readonly name: string;

  /**
   * Description of what this tool does.
   * This is sent to the LLM as part of the tool definition, so it should
   * clearly describe the tool's purpose and capabilities.
   */
  readonly description: string;

  /**
   * Security tier (0-4) for this tool.
   * Determines the level of policy scrutiny and approval required.
   * See the SecurityTier enum for details on each level.
   */
  readonly securityTier: SecurityTier;

  /**
   * JSON Schema describing the tool's accepted parameters.
   * This schema is provided to the LLM so it can construct valid tool calls.
   * Parameter descriptions should be clear enough for the LLM to use correctly.
   */
  readonly parameters: ParameterSchema;

  /**
   * Initialize the tool with configuration.
   *
   * This is where you should:
   * - Validate required configuration and secrets
   * - Set up any persistent state (connections, caches, etc.)
   *
   * @param config - Tool configuration including secrets and resource limits.
   * @throws If required configuration is missing or initialization fails.
   */
  initialize(config: NachosToolConfig): Promise<void>;

  /**
   * Execute the tool with the given parameters.
   *
   * This is called for each LLM tool invocation. Parameters have already
   * been validated by `validate()` before this method is called.
   *
   * @param params - The tool parameters, matching the declared `parameters` schema.
   * @param context - Execution context with session and call identifiers.
   * @returns A structured result with content blocks and optional metadata.
   */
  execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult>;

  /**
   * Validate parameters before execution.
   *
   * This is called before `execute()` to catch invalid parameters early.
   * Return `{ valid: true }` if the parameters are acceptable, or
   * `{ valid: false, errors: [...] }` with descriptive error messages.
   *
   * @param params - The parameters to validate.
   * @returns Validation result with any error messages.
   */
  validate(params: Record<string, unknown>): ToolValidationResult;

  /**
   * Report the health status of this tool.
   *
   * Called periodically by the platform's health check system.
   * Check any dependencies (databases, APIs, filesystem access) and
   * report whether the tool is operational.
   *
   * @returns Health status with an optional error message.
   */
  healthCheck(): Promise<ToolHealthResult>;
}

/**
 * NATS topic helpers for tool containers.
 *
 * Tools receive execution requests and send responses using these topic patterns.
 * If you are using the `@nachos/tool-base` ToolService base class, these topics
 * are managed automatically.
 *
 * @example
 * ```typescript
 * import { TOOL_TOPICS } from '@nachos/sdk';
 *
 * const requestTopic = TOOL_TOPICS.request('my_tool');
 * // -> 'nachos.tool.my_tool.request'
 * ```
 */
export const TOOL_TOPICS = {
  /** Topic for tool execution requests (gateway -> tool). */
  request: (toolId: string) => `nachos.tool.${toolId}.request`,
  /** Topic for tool execution responses (tool -> gateway). */
  response: (toolId: string) => `nachos.tool.${toolId}.response`,
} as const;
