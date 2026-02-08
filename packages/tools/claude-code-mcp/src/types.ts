/**
 * Type Definitions for Claude Code MCP Tool
 */

import type { ToolParameters } from '@nachos/types';

export interface ClaudeCodeOptions {
  tools?: string[];
  [key: string]: unknown;
}

export interface ClaudeCodeParameters extends ToolParameters {
  prompt: string;
  tools?: string[];
  options?: ClaudeCodeOptions;
}
