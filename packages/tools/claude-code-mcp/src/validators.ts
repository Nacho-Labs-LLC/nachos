/**
 * Parameter Validators for Claude Code MCP Tool
 */

import type { ToolValidationResult } from '@nachos/types';

export function validatePrompt(prompt: unknown, maxLength: number): ToolValidationResult {
  if (typeof prompt !== 'string') {
    return { valid: false, errors: ['prompt must be a string'] };
  }

  if (prompt.trim().length === 0) {
    return { valid: false, errors: ['prompt cannot be empty'] };
  }

  if (prompt.length > maxLength) {
    return { valid: false, errors: [`prompt exceeds maximum length of ${maxLength} characters`] };
  }

  return { valid: true };
}

export function validateTools(tools: unknown): ToolValidationResult {
  if (tools === undefined) {
    return { valid: true };
  }

  if (!Array.isArray(tools)) {
    return { valid: false, errors: ['tools must be an array of strings'] };
  }

  const invalid = tools.filter((tool) => typeof tool !== 'string' || tool.trim().length === 0);
  if (invalid.length > 0) {
    return { valid: false, errors: ['tools must be non-empty strings'] };
  }

  return { valid: true };
}
