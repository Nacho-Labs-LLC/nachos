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

export interface StateStoreSemanticConfig {
  enabled?: boolean;
  model?: string;
  cacheDir?: string;
}

export interface StateStoreConfig {
  provider: StateStoreProvider;
  filesystem?: StateStoreFilesystemConfig;
  postgres?: StateStorePostgresConfig;
  semantic?: StateStoreSemanticConfig;
}

export interface SessionStateConfig {
  provider: 'redis' | 'memory';
  redisUrl?: string;
  ttlSeconds?: number;
}

export interface SessionsStoreSQLiteConfig {
  dbPath: string;
}

export interface SessionsStorePostgresConfig {
  connectionString: string;
  schema?: string;
  ssl?: boolean;
  maxConnections?: number;
}

export interface SessionsStoreConfig {
  provider: 'sqlite' | 'postgres';
  sqlite?: SessionsStoreSQLiteConfig;
  postgres?: SessionsStorePostgresConfig;
}

export interface PromptAssemblyConfig {
  hashAlgorithm?: 'sha256';
  includeTokenEstimates?: boolean;
  maxMemoryEntries?: number;
  maxMemoryFacts?: number;
  includeSessionState?: boolean;
}

export interface SemanticStoreConfig {
  provider: 'local' | 'qdrant';
  local?: {
    model?: string;
    cacheDir?: string;
  };
  qdrant?: {
    url?: string;
    collection?: string;
    apiKey?: string;
  };
}

export interface StateLayerConfig {
  identity: StateStoreConfig;
  memory: StateStoreConfig;
  userProfile: StateStoreConfig;
  bootstrap: StateStoreConfig;
  session: SessionStateConfig;
  sessions?: SessionsStoreConfig; // Persistent sessions/messages storage
  semantic?: SemanticStoreConfig; // Semantic/embedding storage
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
