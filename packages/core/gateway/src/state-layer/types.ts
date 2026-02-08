/**
 * State layer configuration and policy hooks.
 */

import type { AuditLogEntryType } from '@nachos/types';

export interface StateStoreFilesystemConfig {
  dir: string;
}

export interface StateStorePostgresConfig {
  connectionString: string;
  schema?: string;
  ssl?: boolean;
  maxConnections?: number;
}

export type StateStoreProvider = 'filesystem' | 'postgres';

export interface StateStoreConfig {
  provider: StateStoreProvider;
  filesystem?: StateStoreFilesystemConfig;
  postgres?: StateStorePostgresConfig;
}

export interface SessionStateConfig {
  provider: 'redis' | 'memory';
  redisUrl?: string;
  ttlSeconds?: number;
}

export interface PromptAssemblyConfig {
  hashAlgorithm?: 'sha256';
  includeTokenEstimates?: boolean;
  maxMemoryEntries?: number;
  maxMemoryFacts?: number;
  includeSessionState?: boolean;
}

export interface StateLayerConfig {
  identity: StateStoreConfig;
  memory: StateStoreConfig;
  session: SessionStateConfig;
  prompt?: PromptAssemblyConfig;
}

export interface StatePolicyRequest {
  action: string;
  sessionId: string;
  userId?: string;
  resource?: string;
  securityMode: 'strict' | 'standard' | 'permissive';
  metadata?: Record<string, unknown>;
}

export interface StatePolicyDecision {
  allowed: boolean;
  reason?: string;
  ruleId?: string;
}

export type StatePolicyCheck = (request: StatePolicyRequest) => Promise<StatePolicyDecision>;

export type StateAuditLogger = (event: AuditLogEntryType) => Promise<void>;

export interface StateLayerDependencies {
  policyCheck?: StatePolicyCheck;
  auditLogger?: StateAuditLogger;
  instanceId?: string;
}
