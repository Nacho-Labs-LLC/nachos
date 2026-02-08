/**
 * Subagent execution types.
 */

import type { LLMRequestType, LLMResponseType } from '@nachos/types';

export interface SubagentTask {
  id: string;
  request: LLMRequestType;
  timeoutMs?: number;
  sandboxMode?: 'host' | 'tool' | 'full';
}

export interface SubagentResult {
  success: boolean;
  response?: LLMResponseType;
  error?: { code: string; message: string; details?: unknown };
  durationMs: number;
  sandboxed: boolean;
}

export interface DockerSandboxConfig {
  image: string;
  network?: 'none' | 'egress' | 'full';
  workspaceDir?: string;
  configDir?: string;
  stateDir?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface SubagentManagerConfig {
  mode: 'host' | 'tool' | 'full';
  docker?: DockerSandboxConfig;
}
