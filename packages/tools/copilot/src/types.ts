/**
 * Type Definitions for GitHub Copilot CLI Tool
 */

import type { ToolParameters } from '@nachos/types';

/**
 * Copilot CLI operation modes
 */
export type CopilotMode = 'explain' | 'suggest' | 'review' | 'general';

/**
 * Parameters for Copilot tool execution
 */
export interface CopilotParameters extends ToolParameters {
  /** The question or prompt to send to GitHub Copilot */
  prompt: string;

  /** Copilot CLI mode of operation (default: 'general') */
  mode?: CopilotMode;

  /** Allow sending prompts that may contain sensitive data (bypasses DLP) */
  allowSensitive?: boolean;

  /** Allow suggestions that may involve file writes (future use) */
  allowWrite?: boolean;

  /** Allow suggestions that may involve code execution (future use) */
  allowExec?: boolean;

  /** Allow suggestions that may involve network operations (future use) */
  allowNetwork?: boolean;

  /** Execution timeout in seconds (default: 30, min: 5, max: 60) */
  timeout?: number;
}

/**
 * Result of CLI command execution
 */
export interface ExecutionResult {
  /** Standard output from the command */
  stdout: string;

  /** Standard error from the command */
  stderr: string;

  /** Process exit code */
  exitCode: number;

  /** Signal that terminated the process (if any) */
  signal?: string;

  /** Whether output was truncated due to size limits */
  truncated: boolean;

  /** Whether the process timed out */
  timedOut?: boolean;
}

/**
 * Options for executing Copilot CLI
 */
export interface ExecuteOptions {
  /** The prompt to send */
  prompt: string;

  /** Operation mode */
  mode: CopilotMode;

  /** Timeout in milliseconds */
  timeout: number;
}
