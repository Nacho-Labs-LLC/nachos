/**
 * Subagent execution types.
 */

import type { LLMRequestType, LLMResponseType, SessionConfig } from '@nachos/types';

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

export type SubagentRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SubagentRequesterInfo {
  sessionId: string;
  channel: string;
  conversationId: string;
  replyToMessageId?: string;
  userId?: string;
}

export interface SubagentAnnounceConfig {
  enabled?: boolean;
  prompt?: string;
}

export interface SubagentOrchestratorConfig {
  maxConcurrent?: number;
  announce?: SubagentAnnounceConfig;
}

export interface SubagentRunRequest {
  task: string;
  label?: string;
  profile?: string;
  agentId?: string;
  requester: SubagentRequesterInfo;
  model?: string;
  thinking?: string;
  timeoutMs?: number;
  cleanup?: 'delete' | 'keep';
  sessionConfig?: SessionConfig;
  sandboxMode?: SubagentTask['sandboxMode'];
}

export interface SubagentRunRecord {
  runId: string;
  status: SubagentRunStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  task: string;
  label?: string;
  profile?: string;
  agentId?: string;
  requester: SubagentRequesterInfo;
  childSessionId: string;
  sandboxed?: boolean;
  durationMs?: number;
  error?: { code: string; message: string };
}
