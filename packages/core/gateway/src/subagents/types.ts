/**
 * Subagent execution types.
 */

import type { LLMRequestType, LLMResponseType, SessionConfig } from '@nachos/types';

export interface SubagentTask {
  id: string;
  request: LLMRequestType;
  timeoutMs?: number;
  sandboxMode?: 'host' | 'tool' | 'full';
  workspaceDir?: string;
  onChunk?: (chunk: string) => void;
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
  maxQueueSize?: number;
  maxPerUser?: number;
  maxStreamChunks?: number;
  maxProgressUpdates?: number;
  announce?: SubagentAnnounceConfig;
  models?: {
    aliases?: Record<string, string>;
    autoSelect?: boolean;
    defaultModel?: string;
    allowedModels?: string[];
  };
}

export interface SubagentRunRequest {
  task: string;
  label?: string;
  profile?: string;
  agentId?: string;
  requester: SubagentRequesterInfo;
  model?: string;
  modelHint?: 'fast' | 'balanced' | 'thorough';
  thinking?: string;
  timeoutMs?: number;
  cleanup?: 'delete' | 'keep';
  sessionConfig?: SessionConfig;
  sandboxMode?: SubagentTask['sandboxMode'];
  stream?: boolean;
}

export interface SubagentProgressUpdate {
  timestamp: string;
  status: string;
  percentage?: number;
  metadata?: Record<string, unknown>;
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
  model?: string;
  requester: SubagentRequesterInfo;
  childSessionId: string;
  sandboxed?: boolean;
  durationMs?: number;
  error?: { code: string; message: string };
  progress?: SubagentProgressUpdate[];
  stream?: boolean;
  streamChunks?: string[];
  workflowId?: string;
  stepId?: string;
}

export type WorkflowRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowStepResult {
  stepId: string;
  runId: string;
  status: SubagentRunStatus;
  result?: string;
  error?: { code: string; message: string };
  durationMs?: number;
}

export interface WorkflowRunRecord {
  workflowId: string;
  status: WorkflowRunStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  requester: SubagentRequesterInfo;
  stepResults: Map<string, WorkflowStepResult>;
  currentBatch?: number;
  totalBatches?: number;
  durationMs?: number;
  error?: { code: string; message: string };
}
