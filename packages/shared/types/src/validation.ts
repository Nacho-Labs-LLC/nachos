/**
 * Message Validation Middleware for Nachos Inter-Component Communication
 *
 * Provides runtime validation of messages using TypeBox schemas.
 * This ensures type safety at runtime boundaries between components.
 */

import { TypeCompiler, type TypeCheck } from '@sinclair/typebox/compiler';
import { Value, type ValueError } from '@sinclair/typebox/value';
import type { TSchema, Static } from '@sinclair/typebox';
import {
  MessageEnvelopeSchema,
  ChannelInboundMessageSchema,
  ChannelOutboundMessageSchema,
  LLMRequestSchema,
  ToolRequestSchema,
  ToolResponseSchema,
  NachosErrorSchema,
  PolicyCheckRequestSchema,
  PolicyCheckResultSchema,
  AuditLogEntrySchema,
  HealthCheckSchema,
  SessionSchema,
  MessageSchema,
  type MessageEnvelopeType,
} from './schemas.js';

// ============================================================================
// Validation Error Types
// ============================================================================

/**
 * Validation error with detailed information
 */
export interface ValidationError {
  /** Field path that failed validation */
  path: string;
  /** Expected type or value */
  expected: string;
  /** Actual value received */
  received: unknown;
  /** Human-readable error message */
  message: string;
}

/**
 * Result of a validation operation
 */
export interface ValidationResult<T> {
  /** Whether validation succeeded */
  success: boolean;
  /** Validated data (if successful) */
  data?: T;
  /** Validation errors (if failed) */
  errors?: ValidationError[];
}

// ============================================================================
// Compiled Validators
// ============================================================================

/**
 * Cache for compiled type checkers
 * TypeBox compilers are expensive to create, so we cache them
 */
const compilerCache = new Map<TSchema, TypeCheck<TSchema>>();

/**
 * Get or create a compiled type checker for a schema
 */
function getCompiler<T extends TSchema>(schema: T): TypeCheck<T> {
  let compiler = compilerCache.get(schema);
  if (!compiler) {
    compiler = TypeCompiler.Compile(schema);
    compilerCache.set(schema, compiler);
  }
  return compiler as TypeCheck<T>;
}

// ============================================================================
// Core Validation Functions
// ============================================================================

/**
 * Get a descriptive type name from a TypeBox schema
 */
function getSchemaTypeName(schema: Record<string, unknown>): string {
  if (schema.$id) return String(schema.$id);
  if (schema.type) return String(schema.type);
  if (schema.anyOf) return 'union';
  if (schema.allOf) return 'intersection';
  if (schema.const !== undefined) return `literal(${JSON.stringify(schema.const)})`;
  return 'unknown';
}

/**
 * Convert TypeBox ValueError to ValidationError
 */
function convertError(error: ValueError): ValidationError {
  return {
    path: error.path,
    expected: getSchemaTypeName(error.schema as Record<string, unknown>),
    received: error.value,
    message: error.message,
  };
}

/**
 * Validate data against a TypeBox schema
 *
 * @param schema - TypeBox schema to validate against
 * @param data - Data to validate
 * @returns Validation result with typed data or errors
 */
export function validate<T extends TSchema>(schema: T, data: unknown): ValidationResult<Static<T>> {
  const compiler = getCompiler(schema);

  if (compiler.Check(data)) {
    return {
      success: true,
      data: data as Static<T>,
    };
  }

  const errors = [...compiler.Errors(data)].map(convertError);
  return {
    success: false,
    errors,
  };
}

/**
 * Validate data and throw if invalid
 *
 * @param schema - TypeBox schema to validate against
 * @param data - Data to validate
 * @returns Validated and typed data
 * @throws Error if validation fails
 */
export function validateOrThrow<T extends TSchema>(schema: T, data: unknown): Static<T> {
  const result = validate(schema, data);

  if (!result.success) {
    const errorMessages = result.errors?.map((e) => `${e.path}: ${e.message}`).join('; ') ?? '';
    throw new Error(`Validation failed: ${errorMessages}`);
  }

  return result.data as Static<T>;
}

/**
 * Check if data is valid against a schema (boolean check only)
 *
 * @param schema - TypeBox schema to validate against
 * @param data - Data to validate
 * @returns Whether the data is valid
 */
export function isValid<T extends TSchema>(schema: T, data: unknown): data is Static<T> {
  const compiler = getCompiler(schema);
  return compiler.Check(data);
}

/**
 * Clean/coerce data to match schema (remove extra properties, apply defaults)
 *
 * @param schema - TypeBox schema to clean against
 * @param data - Data to clean
 * @returns Cleaned data matching the schema
 */
export function clean<T extends TSchema>(schema: T, data: unknown): Static<T> {
  return Value.Clean(schema, data) as Static<T>;
}

/**
 * Apply default values to data based on schema
 *
 * @param schema - TypeBox schema with defaults
 * @param data - Data to apply defaults to
 * @returns Data with defaults applied
 */
export function applyDefaults<T extends TSchema>(schema: T, data: unknown): Static<T> {
  return Value.Default(schema, data) as Static<T>;
}

// ============================================================================
// Pre-compiled Message Validators
// ============================================================================

/**
 * Validate a message envelope
 */
export function validateMessageEnvelope(data: unknown): ValidationResult<MessageEnvelopeType> {
  return validate(MessageEnvelopeSchema, data);
}

/**
 * Validate a channel inbound message payload
 */
export function validateChannelInboundMessage(
  data: unknown
): ValidationResult<Static<typeof ChannelInboundMessageSchema>> {
  return validate(ChannelInboundMessageSchema, data);
}

/**
 * Validate a channel outbound message payload
 */
export function validateChannelOutboundMessage(
  data: unknown
): ValidationResult<Static<typeof ChannelOutboundMessageSchema>> {
  return validate(ChannelOutboundMessageSchema, data);
}

/**
 * Validate an LLM request payload
 */
export function validateLLMRequest(
  data: unknown
): ValidationResult<Static<typeof LLMRequestSchema>> {
  return validate(LLMRequestSchema, data);
}

/**
 * Validate a tool request payload
 */
export function validateToolRequest(
  data: unknown
): ValidationResult<Static<typeof ToolRequestSchema>> {
  return validate(ToolRequestSchema, data);
}

/**
 * Validate a tool response payload
 */
export function validateToolResponse(
  data: unknown
): ValidationResult<Static<typeof ToolResponseSchema>> {
  return validate(ToolResponseSchema, data);
}

/**
 * Validate a policy check request payload
 */
export function validatePolicyCheckRequest(
  data: unknown
): ValidationResult<Static<typeof PolicyCheckRequestSchema>> {
  return validate(PolicyCheckRequestSchema, data);
}

/**
 * Validate a policy check result payload
 */
export function validatePolicyCheckResult(
  data: unknown
): ValidationResult<Static<typeof PolicyCheckResultSchema>> {
  return validate(PolicyCheckResultSchema, data);
}

/**
 * Validate an audit log entry
 */
export function validateAuditLogEntry(
  data: unknown
): ValidationResult<Static<typeof AuditLogEntrySchema>> {
  return validate(AuditLogEntrySchema, data);
}

/**
 * Validate a health check result
 */
export function validateHealthCheck(
  data: unknown
): ValidationResult<Static<typeof HealthCheckSchema>> {
  return validate(HealthCheckSchema, data);
}

/**
 * Validate a Nachos error
 */
export function validateNachosError(
  data: unknown
): ValidationResult<Static<typeof NachosErrorSchema>> {
  return validate(NachosErrorSchema, data);
}

/**
 * Validate a session
 */
export function validateSession(data: unknown): ValidationResult<Static<typeof SessionSchema>> {
  return validate(SessionSchema, data);
}

/**
 * Validate a message
 */
export function validateMessage(data: unknown): ValidationResult<Static<typeof MessageSchema>> {
  return validate(MessageSchema, data);
}

// ============================================================================
// Validation Middleware
// ============================================================================

/**
 * Options for validation middleware
 */
export interface ValidationMiddlewareOptions {
  /** Whether to throw on invalid messages (default: false) */
  throwOnInvalid?: boolean;
  /** Callback for validation errors */
  onError?: (errors: ValidationError[], data: unknown) => void;
}

/**
 * Message handler with validated payload type
 */
export type ValidatedMessageHandler<T> = (
  envelope: MessageEnvelopeType,
  payload: T
) => void | Promise<void>;

/**
 * Create validation middleware for message handlers
 *
 * @param payloadSchema - Schema for the message payload
 * @param handler - Handler to call with validated payload
 * @param options - Middleware options
 * @returns Message handler that validates before processing
 */
export function createValidatedHandler<T extends TSchema>(
  payloadSchema: T,
  handler: ValidatedMessageHandler<Static<T>>,
  options: ValidationMiddlewareOptions = {}
): (envelope: unknown) => Promise<void> {
  return async (envelope: unknown): Promise<void> => {
    // Validate envelope
    const envelopeResult = validateMessageEnvelope(envelope);
    if (!envelopeResult.success || !envelopeResult.data) {
      if (options.onError) {
        options.onError(envelopeResult.errors ?? [], envelope);
      }
      if (options.throwOnInvalid) {
        throw new Error(
          `Invalid message envelope: ${envelopeResult.errors?.map((e) => e.message).join('; ')}`
        );
      }
      return;
    }

    const validatedEnvelope = envelopeResult.data;

    // Validate payload
    const payloadResult = validate(payloadSchema, validatedEnvelope.payload);
    if (!payloadResult.success || !payloadResult.data) {
      if (options.onError) {
        options.onError(payloadResult.errors ?? [], validatedEnvelope.payload);
      }
      if (options.throwOnInvalid) {
        throw new Error(
          `Invalid message payload: ${payloadResult.errors?.map((e) => e.message).join('; ')}`
        );
      }
      return;
    }

    // Call handler with validated data
    await handler(validatedEnvelope, payloadResult.data);
  };
}

/**
 * Create a validated message bus subscriber
 * Wraps a handler with envelope and payload validation
 *
 * @param payloadSchema - Schema for the message payload
 * @param handler - Handler to call with validated data
 * @param options - Validation options
 * @returns Handler function compatible with message bus subscribe
 */
export function withValidation<T extends TSchema>(
  payloadSchema: T,
  handler: ValidatedMessageHandler<Static<T>>,
  options: ValidationMiddlewareOptions = {}
): (data: unknown) => Promise<void> {
  return createValidatedHandler(payloadSchema, handler, options);
}
