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

export type StateStoreProvider = 'filesystem' | 'postgres' | 'sqlite';

export interface StateStoreSemanticConfig {
  enabled?: boolean;
  model?: string;
  cacheDir?: string;
}

export interface StateStoreSqliteConfig {
  dbPath: string;
}

export interface StateStoreConfig {
  provider: StateStoreProvider;
  filesystem?: StateStoreFilesystemConfig;
  postgres?: StateStorePostgresConfig;
  sqlite?: StateStoreSqliteConfig;
  semantic?: StateStoreSemanticConfig;
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

export interface SessionsStoreSqliteConfig {
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
  sqlite?: SessionsStoreSqliteConfig;
  postgres?: SessionsStorePostgresConfig;
}

export interface WorkspaceDocumentStoreConfig {
  provider: 'sqlite' | 'postgres';
  sqlite?: StateStoreSqliteConfig;
  postgres?: StateStorePostgresConfig;
}

export interface StateLayerConfig {
  identity: StateStoreConfig;
  memory: StateStoreConfig;
  userProfile: StateStoreConfig;
  bootstrap: StateStoreConfig;
  session: SessionStateConfig;
  sessions?: SessionsStoreConfig;
  workspace?: WorkspaceDocumentStoreConfig;
  prompt?: PromptAssemblyConfig;
  /**
   * Custom bootstrap prompt content (resolved string, not a file path).
   * When set, replaces the default onboarding conversation block.
   * File path resolution from nachos.toml is done at the Gateway/main level before passing here.
   */
  customBootstrapPrompt?: string;
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
