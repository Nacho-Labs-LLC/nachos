/**
 * @nachos/sdk - Base Tool
 *
 * Abstract base class that auto-wires bus subscriptions for tool containers.
 * Subclass this instead of implementing NachosTool from scratch to get
 * automatic request/response handling, parameter validation, and error wrapping.
 *
 * @example
 * ```typescript
 * import { BaseTool } from '@nachos/sdk';
 * import { SecurityTier } from '@nachos/sdk';
 * import type { ToolResult, ToolExecutionContext } from '@nachos/sdk';
 *
 * export class WeatherTool extends BaseTool {
 *   constructor() {
 *     super({
 *       toolId: 'weather',
 *       name: 'Weather Lookup',
 *       description: 'Look up current weather for a city',
 *       securityTier: SecurityTier.SAFE,
 *       parameters: {
 *         type: 'object',
 *         properties: {
 *           city: { type: 'string', description: 'City name' },
 *         },
 *         required: ['city'],
 *       },
 *     });
 *   }
 *
 *   async execute(
 *     params: Record<string, unknown>,
 *     context: ToolExecutionContext,
 *   ): Promise<ToolResult> {
 *     const city = params['city'] as string;
 *     return {
 *       success: true,
 *       content: [{ type: 'text', text: `Weather in ${city}: Sunny` }],
 *     };
 *   }
 * }
 * ```
 */

import type {
  NachosTool,
  NachosToolConfig,
  ToolExecutionContext,
  ToolValidationResult,
  ToolHealthResult,
} from './tool.js';
import { TOOL_TOPICS } from './tool.js';
import type { PluginBus } from './context.js';
import type { SecurityTier, ParameterSchema, ToolResult } from './types.js';

/**
 * Configuration for the BaseTool constructor.
 * Captures the static metadata that defines a tool.
 */
export interface BaseToolOptions {
  /** Unique tool identifier (used for NATS topics). */
  toolId: string;
  /** Human-readable display name. */
  name: string;
  /** Description shown to the LLM. */
  description: string;
  /** Security tier (0-4). */
  securityTier: SecurityTier;
  /** JSON Schema for accepted parameters. */
  parameters: ParameterSchema;
}

/**
 * Shape of a tool request message received over the bus.
 */
interface ToolRequestMessage {
  /** Unique call identifier. */
  callId?: string;
  /** Session making the request. */
  sessionId?: string;
  /** Tool parameters. */
  params?: Record<string, unknown>;
}

/**
 * Extended tool config that includes bus access.
 * Tools need a bus reference for request/response messaging.
 */
export interface BaseToolConfig extends NachosToolConfig {
  /** The message bus for subscribing to requests and publishing responses. */
  bus: PluginBus;
}

/**
 * Abstract base class for Nachos tools.
 *
 * Handles the bus wiring that every tool needs:
 * - Subscribes to the tool request topic on start()
 * - Deserializes parameters, validates them, calls execute()
 * - Serializes the result and publishes a response
 * - Wraps execute() errors into error ToolResults
 *
 * Subclasses only need to implement:
 * - execute(params, context) -- the actual tool logic
 *
 * Optionally override:
 * - validate(params) -- for custom validation beyond the schema
 * - healthCheck() -- for custom health checks
 * - onInitialize(config) -- for tool-specific setup
 */
export abstract class BaseTool implements NachosTool {
  readonly toolId: string;
  readonly name: string;
  readonly description: string;
  readonly securityTier: SecurityTier;
  readonly parameters: ParameterSchema;

  /** The bus instance, available after initialize() */
  protected bus!: PluginBus;

  /** The tool config, available after initialize() */
  protected toolConfig!: BaseToolConfig;

  /** Whether the tool is currently running */
  private running = false;

  /** Subscription handle for cleanup */
  private requestSubscription: unknown = null;

  constructor(options: BaseToolOptions) {
    this.toolId = options.toolId;
    this.name = options.name;
    this.description = options.description;
    this.securityTier = options.securityTier;
    this.parameters = options.parameters;
  }

  /**
   * Initialize the tool with configuration.
   *
   * Stores the config and bus reference, then calls onInitialize()
   * for tool-specific setup. Subclasses should override onInitialize()
   * rather than this method.
   */
  async initialize(config: NachosToolConfig): Promise<void> {
    // The config must include a bus for base-tool wiring to work
    this.toolConfig = config as BaseToolConfig;
    this.bus = this.toolConfig.bus;

    await this.onInitialize(this.toolConfig);
  }

  /**
   * Start the tool service.
   *
   * Subscribes to the tool request topic and begins handling requests.
   */
  async start(): Promise<void> {
    const requestTopic = TOOL_TOPICS.request(this.toolId);

    this.requestSubscription = await this.bus.subscribe(requestTopic, async (payload: unknown) => {
      await this.handleRequest(payload);
    });

    this.running = true;
  }

  /**
   * Stop the tool service.
   *
   * Unsubscribes from the request topic.
   */
  async stop(): Promise<void> {
    this.running = false;

    if (this.requestSubscription != null) {
      const sub = this.requestSubscription as Record<string, unknown>;
      if (typeof sub.unsubscribe === 'function') {
        (sub.unsubscribe as () => void)();
      } else if (typeof sub.drain === 'function') {
        await (sub.drain as () => Promise<void>)();
      }
      this.requestSubscription = null;
    }
  }

  /**
   * Validate parameters against the declared schema.
   *
   * Performs built-in validation of required fields and types.
   * Subclasses can override this for additional validation, but
   * should call super.validate(params) first.
   */
  validate(params: Record<string, unknown>): ToolValidationResult {
    const errors: string[] = [];
    const schema = this.parameters;

    // Check required parameters
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in params) || params[field] === undefined || params[field] === null) {
          errors.push(`Required parameter missing: ${field}`);
        }
      }
    }

    // Check parameter types for provided values
    for (const [key, value] of Object.entries(params)) {
      const propSchema = schema.properties[key];
      if (!propSchema) {
        // Unknown parameter -- skip unless additionalProperties is false
        if (schema.additionalProperties === false) {
          errors.push(`Unknown parameter: ${key}`);
        }
        continue;
      }

      if (value === undefined || value === null) {
        continue; // Already checked in required validation
      }

      // Basic type checking
      const expectedType = propSchema.type;
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== expectedType) {
        errors.push(`Parameter '${key}' must be ${expectedType}, got ${actualType}`);
      }

      // Enum validation
      if (propSchema.enum && !propSchema.enum.includes(value)) {
        errors.push(`Parameter '${key}' must be one of: ${propSchema.enum.join(', ')}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Report the health status of this tool.
   *
   * Default implementation returns healthy if the tool is running.
   * Subclasses can override for deeper health checks (e.g. API
   * connectivity, filesystem access).
   */
  async healthCheck(): Promise<ToolHealthResult> {
    return { healthy: this.running };
  }

  /**
   * Execute the tool with the given parameters.
   *
   * This is the only method subclasses MUST implement.
   * Parameters have been validated before this is called.
   *
   * @param params - The tool parameters, matching the declared schema.
   * @param context - Execution context with session and call identifiers.
   * @returns A structured result with content blocks.
   */
  abstract execute(
    params: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult>;

  // ---------------------------------------------------------------------------
  // Hooks for subclasses
  // ---------------------------------------------------------------------------

  /**
   * Called during initialize() for tool-specific setup.
   *
   * Override this to validate secrets, create connections, etc.
   * The default implementation is a no-op.
   */
  protected async onInitialize(_config: BaseToolConfig): Promise<void> {
    // Default: no-op
  }

  /**
   * Called when an error occurs in the request handling pipeline.
   *
   * Override for custom error logging. Default is a no-op.
   */
  protected onError(_operation: string, _error: Error, _context?: Record<string, unknown>): void {
    // Default: no-op. Subclasses can override for logging.
  }

  // ---------------------------------------------------------------------------
  // Internal request handling
  // ---------------------------------------------------------------------------

  /**
   * Handle an incoming tool request from the bus.
   * Validates parameters, calls execute(), and publishes the response.
   */
  private async handleRequest(payload: unknown): Promise<void> {
    const startTime = Date.now();
    const request = payload as ToolRequestMessage;

    const context: ToolExecutionContext = {
      sessionId: request.sessionId ?? 'unknown',
      callId: request.callId ?? `${this.toolId}-${Date.now()}`,
    };

    const params = request.params ?? {};

    try {
      // Validate parameters
      const validation = this.validate(params);
      if (!validation.valid) {
        const errorResult: ToolResult = {
          success: false,
          content: [],
          error: {
            code: 'VALIDATION_ERROR',
            message: `Parameter validation failed: ${validation.errors?.join(', ')}`,
            details: validation.errors,
          },
        };
        await this.publishResponse(context, errorResult);
        return;
      }

      // Execute the tool
      const result = await this.execute(params, context);

      // Add duration metadata
      if (!result.metadata) {
        result.metadata = { duration: 0 };
      }
      result.metadata.duration = Date.now() - startTime;

      await this.publishResponse(context, result);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.onError('execute', err, { callId: context.callId, sessionId: context.sessionId });

      const errorResult: ToolResult = {
        success: false,
        content: [],
        error: {
          code: 'EXECUTION_ERROR',
          message: err.message,
        },
        metadata: {
          duration: Date.now() - startTime,
        },
      };
      await this.publishResponse(context, errorResult);
    }
  }

  /**
   * Publish a tool response to the response topic.
   */
  private async publishResponse(context: ToolExecutionContext, result: ToolResult): Promise<void> {
    const responseTopic = TOOL_TOPICS.response(this.toolId);
    await this.bus.publish(responseTopic, {
      callId: context.callId,
      sessionId: context.sessionId,
      toolId: this.toolId,
      result,
    });
  }
}
