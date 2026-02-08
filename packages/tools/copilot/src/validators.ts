/**
 * Parameter Validators for GitHub Copilot CLI Tool
 */

import type { ToolValidationResult } from '@nachos/types';
import type { CopilotMode } from './types.js';

const VALID_MODES: CopilotMode[] = ['explain', 'suggest', 'review', 'general'];

/**
 * Validate prompt parameter
 */
export function validatePrompt(prompt: unknown, maxLength: number): ToolValidationResult {
  if (typeof prompt !== 'string') {
    return {
      valid: false,
      errors: ['prompt must be a string'],
    };
  }

  if (prompt.trim().length === 0) {
    return {
      valid: false,
      errors: ['prompt cannot be empty'],
    };
  }

  if (prompt.length > maxLength) {
    return {
      valid: false,
      errors: [`prompt exceeds maximum length of ${maxLength} characters`],
    };
  }

  return { valid: true };
}

/**
 * Validate mode parameter
 */
export function validateMode(mode: unknown): ToolValidationResult {
  if (typeof mode !== 'string') {
    return {
      valid: false,
      errors: ['mode must be a string'],
    };
  }

  if (!VALID_MODES.includes(mode as CopilotMode)) {
    return {
      valid: false,
      errors: [`mode must be one of: ${VALID_MODES.join(', ')}`],
    };
  }

  return { valid: true };
}

/**
 * Validate timeout parameter
 */
export function validateTimeout(timeout: unknown, maxTimeout: number): ToolValidationResult {
  if (typeof timeout !== 'number') {
    return {
      valid: false,
      errors: ['timeout must be a number'],
    };
  }

  if (timeout < 5) {
    return {
      valid: false,
      errors: ['timeout must be at least 5 seconds'],
    };
  }

  if (timeout > maxTimeout) {
    return {
      valid: false,
      errors: [`timeout cannot exceed ${maxTimeout} seconds`],
    };
  }

  return { valid: true };
}
