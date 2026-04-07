/**
 * Shared prompt utilities for Nachos CLI
 * Handles confirmation prompts with respect for --no-input, --json, --force, and TTY state
 */

import prompts from 'prompts';
import { CLIError } from './errors.js';

export interface ConfirmOptions {
  /** The confirmation message to display */
  message: string;
  /** If true, skip the prompt and proceed (--force) */
  force?: boolean;
  /** If true, skip prompts and return defaultValue (--json mode) */
  json?: boolean;
  /** Default value when auto-confirming (default: false) */
  defaultValue?: boolean;
}

/**
 * Ask for confirmation, respecting --no-input, --json, --force, and TTY state.
 *
 * Returns true if confirmed, false if denied.
 * Throws CLIError if input is required but unavailable.
 */
export async function confirmPrompt(options: ConfirmOptions): Promise<boolean> {
  if (options.force) return true;
  if (options.json) return options.defaultValue ?? false;

  if (!isInteractive()) {
    throw new CLIError(
      'Confirmation required but interactive input is not available',
      'INPUT_REQUIRED',
      1,
      'Pass --force to skip this confirmation, or run in an interactive terminal.'
    );
  }

  const response = await prompts({
    type: 'confirm',
    name: 'confirmed',
    message: options.message,
    initial: options.defaultValue ?? false,
  });

  return response.confirmed ?? false;
}

/**
 * Check if interactive prompts are available.
 * Returns false when --no-input is set or stdin is not a TTY.
 */
export function isInteractive(): boolean {
  if (process.env.NACHOS_NO_INPUT === '1') return false;
  if (!process.stdin.isTTY) return false;
  return true;
}
