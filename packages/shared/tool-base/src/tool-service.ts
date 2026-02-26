/**
 * ToolService - Abstract base class for all NACHOS tools
 *
 * Provides common functionality for:
 * - NATS subscription and message handling
 * - Request validation and response formatting
 * - Error handling and logging
 * - Health checks
 */

import type { NatsConnection, Msg } from 'nats';
import type {
  Tool,
  ToolConfig,
  ToolParameters,
  ToolResult,
  ToolValidationResult,
  ToolHealthStatus,
  SecurityTier,
  ParameterSchema,
  MessageEnvelope,
} from '@nachos/types';

/**
 * Extended tool config that includes NATS connection
 */
export interface ToolServiceConfig extends ToolConfig {
  nats: NatsConnection;
  logger?: Logger;
}

/**
 * Simple logger interface
 */
export interface Logger {
  info(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

/**
 * Console logger implementation
 */
class ConsoleLogger implements Logger {
  constructor(private toolId: string) {}

  info(message: string, ...args: unknown[]): void {
    console.log(`[${this.toolId}] INFO:`, message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    console.error(`[${this.toolId}] ERROR:`, message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(`[${this.toolId}] WARN:`, message, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    console.debug(`[${this.toolId}] DEBUG:`, message, ...args);
  }
}

/**
 * Abstract base class for tool implementations
 * Handles NATS communication, validation, and error handling
 */
export abstract class ToolService implements Tool {
  abstract readonly toolId: string;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly securityTier: SecurityTier;
  abstract readonly parameters: ParameterSchema;

  protected nats!: NatsConnection;
  protected logger!: Logger;
  protected config!: ToolConfig;
  private running = false;

  /**
   * Initialize the tool with configuration
   * Override this method to perform tool-specific initialization
   */
  abstract initialize(config: ToolConfig): Promise<void>;

  /**
   * Execute the tool with given parameters
   * Override this method to implement tool-specific logic
   */
  abstract execute(params: ToolParameters): Promise<ToolResult>;

  /**
   * Validate parameters before execution
   * Override this method to implement tool-specific validation
   */
  abstract validate(params: ToolParameters): ToolValidationResult;

  /**
   * Perform health check
   * Override this method to implement tool-specific health checks
   */
  abstract healthCheck(): Promise<ToolHealthStatus>;

  /**
   * Start the tool service
   * Connects to NATS and begins listening for requests
   */
  async start(config: ToolServiceConfig): Promise<void> {
    this.nats = config.nats;
    this.logger = config.logger ?? new ConsoleLogger(this.toolId);
    this.config = config;

    // Initialize tool-specific setup
    await this.initialize(config);

    this.running = true;
    this.logger.info(`Starting tool service: ${this.name}`);

    // Subscribe to tool request topic
    const topic = `nachos.tool.${this.toolId}.request`;
    const sub = this.nats.subscribe(topic);

    this.logger.info(`Subscribed to topic: ${topic}`);

    // Process messages
    try {
      for await (const msg of sub) {
        if (!this.running) {
          break;
        }
        await this.handleRequest(msg);
      }
    } catch (error) {
      this.logger.error('Error processing messages:', error);
      throw error;
    }
  }

  /**
   * Stop the tool service
   */
  async stop(): Promise<void> {
    this.running = false;
    this.logger.info(`Stopping tool service: ${this.name}`);
  }

  /**
   * Handle an incoming tool request
   * Validates, executes, and responds to the request
   */
  private async handleRequest(msg: Msg): Promise<void> {
    const startTime = Date.now();
    let envelope: MessageEnvelope | null = null;

    try {
      // Parse message envelope
      const data = msg.data.toString();
      envelope = JSON.parse(data) as MessageEnvelope;

      this.logger.debug(`Received request: ${envelope.id}`);

      // Extract parameters from payload
      const params = envelope.payload as ToolParameters;

      // Validate parameters
      const validation = this.validate(params);
      if (!validation.valid) {
        const errorResponse = this.formatErrorResponse(
          'VALIDATION_ERROR',
          `Parameter validation failed: ${validation.errors?.join(', ')}`,
          validation.errors
        );
        await this.respond(msg, errorResponse, envelope.id);
        return;
      }

      // Execute tool
      const result = await this.execute(params);

      // Add duration to metadata
      if (!result.metadata) {
        result.metadata = { duration: 0 };
      }
      result.metadata.duration = Date.now() - startTime;

      // Send success response
      await this.respond(msg, result, envelope.id);

      this.logger.debug(`Request completed: ${envelope.id} (${result.metadata.duration}ms)`);
    } catch (error) {
      this.logger.error('Error handling request:', error);

      const errorResponse = this.formatErrorResponse(
        'EXECUTION_ERROR',
        error instanceof Error ? error.message : 'Unknown error',
        error
      );

      if (envelope) {
        await this.respond(msg, errorResponse, envelope.id);
      } else {
        // If we couldn't parse the envelope, just respond with error
        await this.respond(msg, errorResponse);
      }
    }
  }

  /**
   * Send a response back to the caller
   */
  private async respond(msg: Msg, result: ToolResult, correlationId?: string): Promise<void> {
    const response: MessageEnvelope = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      source: this.toolId,
      type: 'tool.response',
      correlationId,
      payload: result,
    };

    msg.respond(JSON.stringify(response));
  }

  /**
   * Format an error response
   */
  protected formatErrorResponse(code: string, message: string, details?: unknown): ToolResult {
    return {
      success: false,
      content: [],
      error: {
        code,
        message,
        details,
      },
    };
  }

  /**
   * Format a success response with text content
   */
  protected formatTextResponse(text: string, metadata?: ToolResult['metadata']): ToolResult {
    return {
      success: true,
      content: [{ type: 'text', text }],
      metadata,
    };
  }

  /**
   * Format a success response with image content
   */
  protected formatImageResponse(
    data: string,
    mimeType: string,
    source: 'base64' | 'url' = 'base64',
    metadata?: ToolResult['metadata']
  ): ToolResult {
    return {
      success: true,
      content: [{ type: 'image', data, mimeType, source }],
      metadata,
    };
  }

  /**
   * Format a success response with file content
   */
  protected formatFileResponse(
    path: string,
    mimeType?: string,
    size?: number,
    metadata?: ToolResult['metadata']
  ): ToolResult {
    return {
      success: true,
      content: [{ type: 'file', path, mimeType, size }],
      metadata,
    };
  }

  /**
   * Generate a unique ID for messages
   */
  private generateId(): string {
    return `${this.toolId}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Validate a required parameter exists
   */
  protected validateRequired(params: ToolParameters, field: string): ToolValidationResult {
    if (!(field in params) || params[field] === undefined || params[field] === null) {
      return {
        valid: false,
        errors: [`Required parameter missing: ${field}`],
      };
    }
    return { valid: true };
  }

  /**
   * Validate parameter type
   */
  protected validateType(
    params: ToolParameters,
    field: string,
    expectedType: string
  ): ToolValidationResult {
    const value = params[field];
    const actualType = typeof value;

    if (actualType !== expectedType) {
      return {
        valid: false,
        errors: [`Parameter ${field} must be ${expectedType}, got ${actualType}`],
      };
    }
    return { valid: true };
  }

  /**
   * Validate parameter is one of allowed values
   */
  protected validateEnum(
    params: ToolParameters,
    field: string,
    allowedValues: unknown[]
  ): ToolValidationResult {
    const value = params[field];

    if (!allowedValues.includes(value)) {
      return {
        valid: false,
        errors: [`Parameter ${field} must be one of: ${allowedValues.join(', ')}`],
      };
    }
    return { valid: true };
  }

  /**
   * Combine multiple validation results
   */
  protected combineValidations(...validations: ToolValidationResult[]): ToolValidationResult {
    const errors: string[] = [];

    for (const validation of validations) {
      if (!validation.valid && validation.errors) {
        errors.push(...validation.errors);
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
