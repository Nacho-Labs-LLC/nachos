/**
 * Plugin Configuration System
 *
 * Allows plugins to declare their own config schemas (JSON Schema subset)
 * and validates plugin config sections from nachos.toml against those schemas.
 *
 * See docs/design/plugin-config.md for the full design.
 */

import { createLogger } from '@nachos/types';

const logger = createLogger('plugin-config');

// ---------------------------------------------------------------------------
// Schema Types
// ---------------------------------------------------------------------------

/**
 * Supported primitive types for plugin config values.
 */
export type PluginConfigPropertyType = 'string' | 'number' | 'boolean' | 'array' | 'object';

/**
 * Schema for a single property within a plugin config.
 * Supports a practical subset of JSON Schema Draft-07.
 */
export interface PluginConfigPropertySchema {
  type: PluginConfigPropertyType;
  /** Default value when the property is absent from config. */
  default?: unknown;
  /** Restrict values to a fixed set. */
  enum?: unknown[];
  /** Schema for array items (only when type is 'array'). */
  items?: PluginConfigPropertySchema;
  /** Nested properties (only when type is 'object'). */
  properties?: Record<string, PluginConfigPropertySchema>;
  /** Required property names within a nested object. */
  required?: string[];
  /** Whether to allow keys not listed in properties (default: false). */
  additionalProperties?: boolean;
  /** Minimum string length (type: 'string'). */
  minLength?: number;
  /** Maximum string length (type: 'string'). */
  maxLength?: number;
  /** Minimum numeric value (type: 'number'). */
  minimum?: number;
  /** Maximum numeric value (type: 'number'). */
  maximum?: number;
}

/**
 * Root schema for a plugin's configuration section.
 * Must always be type 'object' at the root level.
 */
export interface PluginConfigSchema {
  type: 'object';
  properties: Record<string, PluginConfigPropertySchema>;
  required?: string[];
  /** Whether to allow keys not listed in properties (default: false). */
  additionalProperties?: boolean;
}

// ---------------------------------------------------------------------------
// Validation Result
// ---------------------------------------------------------------------------

/**
 * Result of validating a plugin's config against its schema.
 */
export interface PluginConfigValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Plugin ID Validation
// ---------------------------------------------------------------------------

/** Plugin IDs: lowercase alphanumeric plus hyphens, 1-64 characters. */
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?$/;

/**
 * Validate that a plugin ID is well-formed.
 */
export function isValidPluginId(id: string): boolean {
  return PLUGIN_ID_PATTERN.test(id);
}

// ---------------------------------------------------------------------------
// Schema Validation (validate the schema itself at registration time)
// ---------------------------------------------------------------------------

const VALID_TYPES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'boolean',
  'array',
  'object',
]);

/**
 * Validate a property schema at registration time.
 * Returns an array of error messages (empty if valid).
 */
function validatePropertySchema(schema: PluginConfigPropertySchema, path: string): string[] {
  const errors: string[] = [];

  if (!VALID_TYPES.has(schema.type)) {
    errors.push(`${path}.type must be one of: string, number, boolean, array, object`);
    return errors; // No point checking further with an invalid type.
  }

  // Validate default value type if present.
  if (schema.default !== undefined) {
    const defaultTypeError = checkValueType(schema.default, schema.type, `${path}.default`);
    if (defaultTypeError) {
      errors.push(defaultTypeError);
    }
  }

  // Validate enum entries match declared type.
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
      errors.push(`${path}.enum must be a non-empty array`);
    } else {
      for (let i = 0; i < schema.enum.length; i++) {
        const entryError = checkValueType(schema.enum[i], schema.type, `${path}.enum[${i}]`);
        if (entryError) {
          errors.push(entryError);
        }
      }
    }
  }

  // Array items schema.
  if (schema.type === 'array') {
    if (schema.items) {
      errors.push(...validatePropertySchema(schema.items, `${path}.items`));
    }
  } else if (schema.items) {
    errors.push(`${path}.items is only valid when type is 'array'`);
  }

  // Nested object properties.
  if (schema.type === 'object') {
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        errors.push(...validatePropertySchema(propSchema, `${path}.properties.${key}`));
      }
    }
    if (schema.required) {
      if (!Array.isArray(schema.required)) {
        errors.push(`${path}.required must be an array of strings`);
      } else {
        for (const reqKey of schema.required) {
          if (typeof reqKey !== 'string') {
            errors.push(`${path}.required entries must be strings`);
          } else if (schema.properties && !(reqKey in schema.properties)) {
            errors.push(`${path}.required references unknown property "${reqKey}"`);
          }
        }
      }
    }
  } else {
    if (schema.properties) {
      errors.push(`${path}.properties is only valid when type is 'object'`);
    }
    if (schema.required) {
      errors.push(`${path}.required is only valid when type is 'object'`);
    }
  }

  // String constraints only for type: string.
  if (schema.minLength !== undefined && schema.type !== 'string') {
    errors.push(`${path}.minLength is only valid when type is 'string'`);
  }
  if (schema.maxLength !== undefined && schema.type !== 'string') {
    errors.push(`${path}.maxLength is only valid when type is 'string'`);
  }
  if (schema.minLength !== undefined && schema.maxLength !== undefined) {
    if (schema.minLength > schema.maxLength) {
      errors.push(`${path}.minLength must be <= maxLength`);
    }
  }

  // Numeric constraints only for type: number.
  if (schema.minimum !== undefined && schema.type !== 'number') {
    errors.push(`${path}.minimum is only valid when type is 'number'`);
  }
  if (schema.maximum !== undefined && schema.type !== 'number') {
    errors.push(`${path}.maximum is only valid when type is 'number'`);
  }
  if (schema.minimum !== undefined && schema.maximum !== undefined) {
    if (schema.minimum > schema.maximum) {
      errors.push(`${path}.minimum must be <= maximum`);
    }
  }

  return errors;
}

/**
 * Validate a root plugin config schema at registration time.
 */
function validateRootSchema(schema: PluginConfigSchema): string[] {
  const errors: string[] = [];

  if (schema.type !== 'object') {
    errors.push('Root schema type must be "object"');
    return errors;
  }

  if (!schema.properties || typeof schema.properties !== 'object') {
    errors.push('Root schema must have a "properties" object');
    return errors;
  }

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    errors.push(...validatePropertySchema(propSchema, `properties.${key}`));
  }

  if (schema.required) {
    if (!Array.isArray(schema.required)) {
      errors.push('Root schema "required" must be an array of strings');
    } else {
      for (const reqKey of schema.required) {
        if (typeof reqKey !== 'string') {
          errors.push('Root schema "required" entries must be strings');
        } else if (!(reqKey in schema.properties)) {
          errors.push(`Root schema "required" references unknown property "${reqKey}"`);
        }
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Value Validation (validate config values against schema)
// ---------------------------------------------------------------------------

/**
 * Check that a value matches the declared type.
 * Returns an error message if the type is wrong, or null if it matches.
 */
function checkValueType(
  value: unknown,
  expectedType: PluginConfigPropertyType,
  path: string
): string | null {
  switch (expectedType) {
    case 'string':
      if (typeof value !== 'string') {
        return `${path} must be a string, got ${typeof value}`;
      }
      return null;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return `${path} must be a number, got ${typeof value}`;
      }
      return null;
    case 'boolean':
      if (typeof value !== 'boolean') {
        return `${path} must be a boolean, got ${typeof value}`;
      }
      return null;
    case 'array':
      if (!Array.isArray(value)) {
        return `${path} must be an array, got ${typeof value}`;
      }
      return null;
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return `${path} must be an object, got ${Array.isArray(value) ? 'array' : typeof value}`;
      }
      return null;
  }
}

/**
 * Validate a single property value against its schema.
 * Pushes any errors into the provided array.
 */
function validatePropertyValue(
  value: unknown,
  schema: PluginConfigPropertySchema,
  errors: string[],
  path: string
): void {
  // Type check.
  const typeError = checkValueType(value, schema.type, path);
  if (typeError) {
    errors.push(typeError);
    return; // Don't check constraints if the type is wrong.
  }

  // Enum check.
  if (schema.enum !== undefined) {
    if (!schema.enum.includes(value)) {
      errors.push(
        `${path} must be one of: ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`
      );
      return;
    }
  }

  // String constraints.
  if (schema.type === 'string' && typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path} must be at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path} must be at most ${schema.maxLength} characters`);
    }
  }

  // Numeric constraints.
  if (schema.type === 'number' && typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path} must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path} must be <= ${schema.maximum}`);
    }
  }

  // Array items.
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      validatePropertyValue(value[i], schema.items, errors, `${path}[${i}]`);
    }
  }

  // Nested object.
  if (
    schema.type === 'object' &&
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const obj = value as Record<string, unknown>;
    const allowAdditional = schema.additionalProperties ?? false;

    // Check for unknown keys.
    if (schema.properties && !allowAdditional) {
      for (const key of Object.keys(obj)) {
        if (!(key in schema.properties)) {
          errors.push(`${path}: unknown property "${key}"`);
        }
      }
    }

    // Validate nested required fields.
    if (schema.required) {
      for (const reqKey of schema.required) {
        if (!(reqKey in obj) || obj[reqKey] === undefined) {
          errors.push(`${path}.${reqKey} is required`);
        }
      }
    }

    // Validate nested property values.
    if (schema.properties) {
      for (const [propKey, propSchema] of Object.entries(schema.properties)) {
        if (propKey in obj && obj[propKey] !== undefined) {
          validatePropertyValue(obj[propKey], propSchema, errors, `${path}.${propKey}`);
        }
      }
    }
  }
}

/**
 * Validate a plugin's config values against a root schema.
 */
export function validatePluginConfig(
  schema: PluginConfigSchema,
  config: Record<string, unknown>
): PluginConfigValidationResult {
  const errors: string[] = [];
  const allowAdditional = schema.additionalProperties ?? false;

  // Check for unknown top-level keys.
  if (!allowAdditional) {
    for (const key of Object.keys(config)) {
      if (!(key in schema.properties)) {
        errors.push(`Unknown property "${key}"`);
      }
    }
  }

  // Check required fields.
  if (schema.required) {
    for (const reqKey of schema.required) {
      if (!(reqKey in config) || config[reqKey] === undefined) {
        errors.push(`"${reqKey}" is required`);
      }
    }
  }

  // Validate each declared property that is present.
  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (key in config && config[key] !== undefined) {
      validatePropertyValue(config[key], propSchema, errors, `"${key}"`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Default Value Application
// ---------------------------------------------------------------------------

/**
 * Apply default values from a schema to a config object.
 * Returns a new object with defaults filled in for missing properties.
 * Does not mutate the original config.
 */
export function applyDefaults(
  schema: PluginConfigSchema,
  config: Record<string, unknown>
): Record<string, unknown> {
  return applyObjectDefaults(schema.properties, config);
}

function applyObjectDefaults(
  properties: Record<string, PluginConfigPropertySchema>,
  config: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...config };

  for (const [key, propSchema] of Object.entries(properties)) {
    if (!(key in result) || result[key] === undefined) {
      // Property is missing -- apply default if declared.
      if (propSchema.default !== undefined) {
        result[key] = structuredClone(propSchema.default);
      }
    } else if (
      propSchema.type === 'object' &&
      propSchema.properties &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      // Recursively apply defaults for nested objects.
      result[key] = applyObjectDefaults(
        propSchema.properties,
        result[key] as Record<string, unknown>
      );
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Plugin Config Registry
// ---------------------------------------------------------------------------

/**
 * Error thrown when a plugin config schema is invalid or a registration fails.
 */
export class PluginConfigError extends Error {
  constructor(
    message: string,
    public readonly pluginId: string,
    public readonly errors: string[] = []
  ) {
    super(message);
    this.name = 'PluginConfigError';
  }
}

/**
 * Central registry for plugin configuration schemas.
 *
 * Plugins register their schemas during discovery/startup. At config load
 * time, the registry validates each `[plugins.<id>]` section against the
 * registered schema.
 */
export class PluginConfigRegistry {
  private schemas = new Map<string, PluginConfigSchema>();

  /**
   * Register a plugin's config schema.
   *
   * @param pluginId - Unique plugin identifier (slug format).
   * @param schema - The plugin's config schema.
   * @throws PluginConfigError if the ID is invalid, already registered, or the schema is malformed.
   */
  register(pluginId: string, schema: PluginConfigSchema): void {
    if (!isValidPluginId(pluginId)) {
      throw new PluginConfigError(
        `Invalid plugin ID "${pluginId}": must be lowercase alphanumeric with hyphens, 1-64 characters`,
        pluginId
      );
    }

    if (this.schemas.has(pluginId)) {
      throw new PluginConfigError(`Plugin "${pluginId}" is already registered`, pluginId);
    }

    // Validate the schema itself before accepting it.
    const schemaErrors = validateRootSchema(schema);
    if (schemaErrors.length > 0) {
      throw new PluginConfigError(
        `Invalid config schema for plugin "${pluginId}": ${schemaErrors.join('; ')}`,
        pluginId,
        schemaErrors
      );
    }

    this.schemas.set(pluginId, schema);
    logger.debug({ pluginId }, 'Registered plugin config schema');
  }

  /**
   * Validate a plugin's config section against its registered schema.
   *
   * @param pluginId - The plugin ID to validate for.
   * @param config - The raw config values from `[plugins.<id>]`.
   * @returns Validation result with errors if any.
   * @throws PluginConfigError if the plugin is not registered.
   */
  validate(pluginId: string, config: Record<string, unknown>): PluginConfigValidationResult {
    const schema = this.schemas.get(pluginId);
    if (!schema) {
      throw new PluginConfigError(`No schema registered for plugin "${pluginId}"`, pluginId);
    }

    return validatePluginConfig(schema, config);
  }

  /**
   * Apply default values from the registered schema.
   *
   * @param pluginId - The plugin ID.
   * @param config - The raw config values.
   * @returns A new object with defaults applied.
   * @throws PluginConfigError if the plugin is not registered.
   */
  applyDefaults(pluginId: string, config: Record<string, unknown>): Record<string, unknown> {
    const schema = this.schemas.get(pluginId);
    if (!schema) {
      throw new PluginConfigError(`No schema registered for plugin "${pluginId}"`, pluginId);
    }

    return applyDefaults(schema, config);
  }

  /**
   * Validate all plugin sections from a config's `plugins` map.
   *
   * For each key in `pluginsConfig`:
   * - If the plugin has a registered schema, validate against it.
   * - If the plugin has no registered schema, report an error (typo protection).
   *
   * @param pluginsConfig - The `[plugins]` section from nachos.toml.
   * @returns Combined validation result across all plugins.
   */
  validateAll(
    pluginsConfig: Record<string, Record<string, unknown>>
  ): PluginConfigValidationResult {
    const errors: string[] = [];

    for (const [pluginId, pluginValues] of Object.entries(pluginsConfig)) {
      if (!this.schemas.has(pluginId)) {
        errors.push(`plugins.${pluginId}: no schema registered for this plugin`);
        continue;
      }

      const result = this.validate(pluginId, pluginValues);
      for (const err of result.errors) {
        errors.push(`plugins.${pluginId}: ${err}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get all registered plugin IDs.
   */
  getRegisteredPlugins(): string[] {
    return Array.from(this.schemas.keys());
  }

  /**
   * Check whether a plugin has a registered schema.
   */
  hasPlugin(pluginId: string): boolean {
    return this.schemas.has(pluginId);
  }

  /**
   * Get the schema for a registered plugin.
   * Returns undefined if the plugin is not registered.
   */
  getSchema(pluginId: string): PluginConfigSchema | undefined {
    return this.schemas.get(pluginId);
  }

  /**
   * Remove all registered schemas. Useful for testing.
   */
  clear(): void {
    this.schemas.clear();
  }
}
