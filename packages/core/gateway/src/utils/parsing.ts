/**
 * Pure parsing and validation utility functions.
 * Extracted from Gateway to reduce the monolithic class.
 */

/**
 * Parse an optional string value, returning undefined for non-strings or empty/whitespace.
 */
export function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Parse an optional string array, returning null for non-arrays or empty results.
 */
export function readOptionalStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : null;
}

/**
 * Parse an optional number value with range validation.
 */
export function readOptionalNumber(
  value: unknown,
  limits?: { min?: number; max?: number }
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  if (limits?.min !== undefined && value < limits.min) {
    return undefined;
  }
  if (limits?.max !== undefined && value > limits.max) {
    return undefined;
  }
  return value;
}

/**
 * Parse an optional boolean value.
 */
export function readOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value !== 'boolean') {
    return undefined;
  }
  return value;
}

/**
 * Parse an optional string map (Record<string, string>).
 * Returns null if value is not a plain object or contains non-string values.
 */
export function readOptionalStringMap(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'string') {
      return null;
    }
    result[key] = entry;
  }
  return result;
}

/**
 * Parse a timeout value in seconds and convert to milliseconds.
 */
export function readTimeoutMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const rounded = Math.floor(value);
  if (rounded <= 0) {
    return undefined;
  }
  return rounded * 1000;
}

/**
 * Parse a cleanup mode value.
 */
export function readCleanup(value: unknown): 'delete' | 'keep' | undefined {
  if (value === 'delete' || value === 'keep') {
    return value;
  }
  return undefined;
}

/**
 * Safely stringify tool parameters to JSON.
 */
export function stringifyToolParameters(parameters: Record<string, unknown>): string {
  try {
    return JSON.stringify(parameters);
  } catch {
    return '';
  }
}

/**
 * Coerce LLM content (string or content blocks array) to plain text.
 */
export function coerceLLMContentText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object' || !('text' in part)) {
          return '';
        }
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      })
      .filter((text) => text.length > 0)
      .join('');
  }

  return '';
}
