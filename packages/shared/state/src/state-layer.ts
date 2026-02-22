/**
 * State layer composition and policy-enforced operations.
 */

import pg from 'pg';
import type { Pool } from 'pg';
import { createConfigError, createPolicyDeniedError, createLogger } from '@nachos/types';

const logger = createLogger('state-layer');
import type {
  IdentityProfile,
  IdentityStore,
  BootstrapProfile,
  BootstrapStore,
  MemoryEntry,
  MemoryFact,
  MemoryQuery,
  MemoryQueryResult,
  MemoryStore,
  PromptAssemblyResult,
  SessionStateRecord,
  SessionStateStore,
  UserProfile,
  UserProfileStore,
} from '@nachos/types';
import type { StateLayerConfig, StateLayerDependencies, StatePolicyRequest } from './types.js';
import { FilesystemIdentityStore } from './identity/filesystem-identity-store.js';
import { PostgresIdentityStore } from './identity/postgres-identity-store.js';
import { FilesystemBootstrapStore } from './bootstrap/filesystem-bootstrap-store.js';
import { PostgresBootstrapStore } from './bootstrap/postgres-bootstrap-store.js';
import { createDefaultBootstrapBlocks } from './bootstrap/bootstrap-templates.js';
import { FilesystemMemoryStore } from './memory/filesystem-memory-store.js';
import { PostgresMemoryStore } from './memory/postgres-memory-store.js';
import { FilesystemUserProfileStore } from './user-profile/filesystem-user-profile-store.js';
import { PostgresUserProfileStore } from './user-profile/postgres-user-profile-store.js';
import {
  InMemorySessionStateStore,
  RedisSessionStateStore,
} from './session/redis-session-state-store.js';
import { PromptAssembler } from './prompt/prompt-assembler.js';
import type { PromptAssemblyParams } from './prompt/prompt-assembler.js';
import type { StateStorePostgresConfig } from './types.js';

export interface StateOperationContext {
  sessionId: string;
  userId?: string;
  securityMode: 'strict' | 'standard' | 'permissive';
  channel?: string;
  internalTool?: boolean;
}

export class StateLayer {
  private identityStore: IdentityStore;
  private bootstrapStore: BootstrapStore;
  private memoryStore: MemoryStore;
  private userProfileStore: UserProfileStore;
  private sessionStateStore: SessionStateStore;
  private promptAssembler: PromptAssembler;
  private dependencies: StateLayerDependencies;
  private pgPools: Pool[];

  constructor(params: {
    identityStore: IdentityStore;
    bootstrapStore: BootstrapStore;
    memoryStore: MemoryStore;
    userProfileStore: UserProfileStore;
    sessionStateStore: SessionStateStore;
    promptAssembler: PromptAssembler;
    dependencies?: StateLayerDependencies;
    pgPools?: Pool[];
  }) {
    this.identityStore = params.identityStore;
    this.bootstrapStore = params.bootstrapStore;
    this.memoryStore = params.memoryStore;
    this.userProfileStore = params.userProfileStore;
    this.sessionStateStore = params.sessionStateStore;
    this.promptAssembler = params.promptAssembler;
    this.dependencies = params.dependencies ?? {};
    this.pgPools = params.pgPools ?? [];

    if (!this.dependencies.policyCheck) {
      logger.warn('No policyCheck provided — all state operations will be permitted without enforcement.');
    }
    if (!this.dependencies.auditLogger) {
      logger.warn('No auditLogger provided — state operations will not be audited.');
    }
  }

  /**
   * Initialize the state layer (e.g., semantic search if enabled)
   * Call this after creating the StateLayer instance
   */
  async init(): Promise<void> {
    // Initialize memory store if it supports semantic search
    if ('init' in this.memoryStore && typeof this.memoryStore.init === 'function') {
      await this.memoryStore.init();
    }
  }

  async getIdentity(
    agentId: string,
    context: StateOperationContext
  ): Promise<IdentityProfile | null> {
    await this.ensureAllowed('state.identity.read', context, agentId);
    const profile = await this.identityStore.get(agentId);
    await this.auditAllowed('state.identity.read', context, agentId);
    return profile;
  }

  async putIdentity(
    profile: IdentityProfile,
    context: StateOperationContext
  ): Promise<IdentityProfile> {
    await this.ensureAllowed('state.identity.write', context, profile.agentId);
    const stored = await this.identityStore.put(profile);
    await this.auditAllowed('state.identity.write', context, profile.agentId);
    return stored;
  }

  async deleteIdentity(agentId: string, context: StateOperationContext): Promise<void> {
    await this.ensureAllowed('state.identity.delete', context, agentId);
    await this.identityStore.delete(agentId);
    await this.auditAllowed('state.identity.delete', context, agentId);
  }

  async getBootstrap(
    agentId: string,
    context: StateOperationContext
  ): Promise<BootstrapProfile | null> {
    await this.ensureAllowed('state.bootstrap.read', context, agentId);
    let profile = await this.bootstrapStore.get(agentId);
    if (!profile) {
      try {
        profile = await this.seedBootstrapProfile(agentId, context);
      } catch {
        profile = null;
      }
    }
    await this.auditAllowed('state.bootstrap.read', context, agentId);
    return profile;
  }

  async putBootstrap(
    profile: BootstrapProfile,
    context: StateOperationContext
  ): Promise<BootstrapProfile> {
    await this.ensureAllowed('state.bootstrap.write', context, profile.agentId);
    const stored = await this.bootstrapStore.put(profile);
    await this.auditAllowed('state.bootstrap.write', context, profile.agentId);
    return stored;
  }

  async deleteBootstrap(agentId: string, context: StateOperationContext): Promise<void> {
    await this.ensureAllowed('state.bootstrap.delete', context, agentId);
    await this.bootstrapStore.delete(agentId);
    await this.auditAllowed('state.bootstrap.delete', context, agentId);
  }

  private async seedBootstrapProfile(
    agentId: string,
    context: StateOperationContext
  ): Promise<BootstrapProfile | null> {
    const profile: BootstrapProfile = {
      agentId,
      content: createDefaultBootstrapBlocks(),
      updatedAt: new Date().toISOString(),
      version: 1,
      source: 'default',
    };

    await this.ensureAllowed('state.bootstrap.write', context, agentId);
    const stored = await this.bootstrapStore.put(profile);
    await this.auditAllowed('state.bootstrap.write', context, agentId);
    return stored;
  }

  async appendMemoryEntry(
    entry: MemoryEntry,
    context: StateOperationContext
  ): Promise<MemoryEntry> {
    await this.ensureAllowed('state.memory.append', context, entry.agentId);
    const stored = await this.memoryStore.appendEntry(entry);
    await this.auditAllowed('state.memory.append', context, entry.agentId);
    return stored;
  }

  async appendMemoryFacts(
    facts: MemoryFact[],
    context: StateOperationContext
  ): Promise<MemoryFact[]> {
    const [first] = facts;
    if (!first) return facts;
    await this.ensureAllowed('state.memory.append', context, first.agentId);
    const stored = await this.memoryStore.appendFacts(facts);
    await this.auditAllowed('state.memory.append', context, first.agentId);
    return stored;
  }

  async queryMemory(
    query: MemoryQuery,
    context: StateOperationContext
  ): Promise<MemoryQueryResult> {
    await this.ensureAllowed('state.memory.query', context, query.agentId);
    const result = await this.memoryStore.query(query);
    await this.auditAllowed('state.memory.query', context, query.agentId);
    return result;
  }

  async deleteMemoryEntry(
    id: string,
    agentId: string,
    context: StateOperationContext
  ): Promise<void> {
    await this.ensureAllowed('state.memory.delete', context, agentId);
    await this.memoryStore.deleteEntry(id, agentId);
    await this.auditAllowed('state.memory.delete', context, agentId);
  }

  async getUserProfile(
    agentId: string,
    userId: string,
    context: StateOperationContext
  ): Promise<UserProfile | null> {
    await this.ensureAllowed('state.user-profile.read', context, `${agentId}:${userId}`);
    const profile = await this.userProfileStore.get(agentId, userId);
    await this.auditAllowed('state.user-profile.read', context, `${agentId}:${userId}`);
    return profile;
  }

  async putUserProfile(profile: UserProfile, context: StateOperationContext): Promise<UserProfile> {
    await this.ensureAllowed(
      'state.user-profile.write',
      context,
      `${profile.agentId}:${profile.userId}`
    );
    const stored = await this.userProfileStore.put(profile);
    await this.auditAllowed(
      'state.user-profile.write',
      context,
      `${profile.agentId}:${profile.userId}`
    );
    return stored;
  }

  async deleteUserProfile(
    agentId: string,
    userId: string,
    context: StateOperationContext
  ): Promise<void> {
    await this.ensureAllowed('state.user-profile.delete', context, `${agentId}:${userId}`);
    await this.userProfileStore.delete(agentId, userId);
    await this.auditAllowed('state.user-profile.delete', context, `${agentId}:${userId}`);
  }

  async getSessionState(
    sessionId: string,
    context: StateOperationContext
  ): Promise<SessionStateRecord | null> {
    await this.ensureAllowed('state.session.read', context, sessionId);
    const record = await this.sessionStateStore.get(sessionId);
    await this.auditAllowed('state.session.read', context, sessionId);
    return record;
  }

  async setSessionState(
    record: SessionStateRecord,
    context: StateOperationContext
  ): Promise<SessionStateRecord> {
    await this.ensureAllowed('state.session.write', context, record.sessionId);
    const stored = await this.sessionStateStore.set(record);
    await this.auditAllowed('state.session.write', context, record.sessionId);
    return stored;
  }

  async touchSessionState(
    sessionId: string,
    context: StateOperationContext,
    ttlSeconds?: number
  ): Promise<void> {
    await this.ensureAllowed('state.session.touch', context, sessionId);
    await this.sessionStateStore.touch(sessionId, ttlSeconds);
    await this.auditAllowed('state.session.touch', context, sessionId);
  }

  async deleteSessionState(sessionId: string, context: StateOperationContext): Promise<void> {
    await this.ensureAllowed('state.session.delete', context, sessionId);
    await this.sessionStateStore.delete(sessionId);
    await this.auditAllowed('state.session.delete', context, sessionId);
  }

  assemblePrompt(params: PromptAssemblyParams): PromptAssemblyResult {
    return this.promptAssembler.assemble(params);
  }

  async close(): Promise<void> {
    const closers = [
      this.identityStore,
      this.bootstrapStore,
      this.memoryStore,
      this.userProfileStore,
      this.sessionStateStore,
    ] as Array<{
      close?: () => Promise<void>;
    }>;
    for (const store of closers) {
      if (store.close) {
        await store.close();
      }
    }
    // Close shared Postgres pools after stores are done
    for (const pool of this.pgPools) {
      await pool.end();
    }
  }

  private async ensureAllowed(
    action: string,
    context: StateOperationContext,
    resource?: string
  ): Promise<void> {
    if (context.internalTool) {
      // Still audit internal tool operations even though policy check is skipped
      await this.auditAllowed(action, context, resource);
      return;
    }
    if (!this.dependencies.policyCheck) return;

    const request: StatePolicyRequest = {
      action,
      sessionId: context.sessionId,
      userId: context.userId,
      resource,
      securityMode: context.securityMode,
      metadata: { channel: context.channel },
    };

    const decision = await this.dependencies.policyCheck(request);
    if (!decision.allowed) {
      await this.auditDenied(action, context, resource, decision.reason, decision.ruleId);
      throw createPolicyDeniedError(decision.reason ?? `Policy denied ${action}`, { component: 'gateway' });
    }
  }

  private async auditAllowed(
    action: string,
    context: StateOperationContext,
    resource?: string
  ): Promise<void> {
    if (!this.dependencies.auditLogger) return;

    await this.dependencies.auditLogger({
      id: `${action}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      instanceId: this.dependencies.instanceId ?? 'gateway',
      userId: context.userId ?? 'unknown',
      sessionId: context.sessionId,
      channel: context.channel ?? 'internal',
      eventType: 'policy_check',
      action,
      resource,
      outcome: 'allowed',
      securityMode: context.securityMode,
    });
  }

  private async auditDenied(
    action: string,
    context: StateOperationContext,
    resource?: string,
    reason?: string,
    ruleId?: string
  ): Promise<void> {
    if (!this.dependencies.auditLogger) return;

    await this.dependencies.auditLogger({
      id: `${action}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      instanceId: this.dependencies.instanceId ?? 'gateway',
      userId: context.userId ?? 'unknown',
      sessionId: context.sessionId,
      channel: context.channel ?? 'internal',
      eventType: 'policy_check',
      action,
      resource,
      outcome: 'denied',
      reason,
      securityMode: context.securityMode,
      policyMatched: ruleId,
    });
  }
}

export function createStateLayer(
  config: StateLayerConfig,
  deps?: StateLayerDependencies
): StateLayer {
  // Deduplicate Postgres pools by connection string so all stores sharing the
  // same database use a single pool instead of creating four separate ones.
  const poolMap = new Map<string, Pool>();
  const pgPools: Pool[] = [];

  function getOrCreatePool(settings: StateStorePostgresConfig): Pool {
    const existing = poolMap.get(settings.connectionString);
    if (existing) return existing;
    const pool = createPgPool(settings);
    poolMap.set(settings.connectionString, pool);
    pgPools.push(pool);
    return pool;
  }

  const identityStore = createIdentityStore(config, getOrCreatePool);
  const bootstrapStore = createBootstrapStore(config, getOrCreatePool);
  const memoryStore = createMemoryStore(config, getOrCreatePool);
  const userProfileStore = createUserProfileStore(config, getOrCreatePool);
  const sessionStore = createSessionStateStore(config);
  const promptAssembler = new PromptAssembler(config.prompt);

  return new StateLayer({
    identityStore,
    bootstrapStore,
    memoryStore,
    userProfileStore,
    sessionStateStore: sessionStore,
    promptAssembler,
    dependencies: deps,
    pgPools,
  });
}

function createIdentityStore(
  config: StateLayerConfig,
  getOrCreatePool: (settings: StateStorePostgresConfig) => Pool
): IdentityStore {
  if (config.identity.provider === 'postgres') {
    const settings = config.identity.postgres;
    if (!settings?.connectionString) {
      throw createConfigError('Postgres identity store requires connectionString', { component: 'gateway' });
    }
    return new PostgresIdentityStore(getOrCreatePool(settings), settings.schema);
  }

  const dir = config.identity.filesystem?.dir;
  if (!dir) {
    throw createConfigError('Filesystem identity store requires dir', { component: 'gateway' });
  }
  return new FilesystemIdentityStore(dir);
}

function createBootstrapStore(
  config: StateLayerConfig,
  getOrCreatePool: (settings: StateStorePostgresConfig) => Pool
): BootstrapStore {
  if (config.bootstrap.provider === 'postgres') {
    const settings = config.bootstrap.postgres;
    if (!settings?.connectionString) {
      throw createConfigError('Postgres bootstrap store requires connectionString', { component: 'gateway' });
    }
    return new PostgresBootstrapStore(getOrCreatePool(settings), settings.schema);
  }

  const dir = config.bootstrap.filesystem?.dir;
  if (!dir) {
    throw createConfigError('Filesystem bootstrap store requires dir', { component: 'gateway' });
  }
  return new FilesystemBootstrapStore(dir);
}

function createMemoryStore(
  config: StateLayerConfig,
  getOrCreatePool: (settings: StateStorePostgresConfig) => Pool
): MemoryStore {
  if (config.memory.provider === 'postgres') {
    const settings = config.memory.postgres;
    if (!settings?.connectionString) {
      throw createConfigError('Postgres memory store requires connectionString', { component: 'gateway' });
    }
    return new PostgresMemoryStore(getOrCreatePool(settings), settings.schema);
  }

  const dir = config.memory.filesystem?.dir;
  if (!dir) {
    throw createConfigError('Filesystem memory store requires dir', { component: 'gateway' });
  }
  
  return new FilesystemMemoryStore({
    baseDir: dir,
    enableSemantic: config.memory.semantic?.enabled ?? false,
    semanticModel: config.memory.semantic?.model,
    semanticCacheDir: config.memory.semantic?.cacheDir,
  });
}

function createUserProfileStore(
  config: StateLayerConfig,
  getOrCreatePool: (settings: StateStorePostgresConfig) => Pool
): UserProfileStore {
  if (config.userProfile.provider === 'postgres') {
    const settings = config.userProfile.postgres;
    if (!settings?.connectionString) {
      throw createConfigError('Postgres user profile store requires connectionString', { component: 'gateway' });
    }
    return new PostgresUserProfileStore(getOrCreatePool(settings), settings.schema);
  }

  const dir = config.userProfile.filesystem?.dir;
  if (!dir) {
    throw createConfigError('Filesystem user profile store requires dir', { component: 'gateway' });
  }
  return new FilesystemUserProfileStore(dir);
}

function createSessionStateStore(config: StateLayerConfig): SessionStateStore {
  if (config.session.provider === 'redis') {
    const redisUrl = config.session.redisUrl;
    if (!redisUrl) {
      throw createConfigError('Redis session state store requires redisUrl', { component: 'gateway' });
    }
    return new RedisSessionStateStore(redisUrl, config.session.ttlSeconds);
  }

  logger.warn('Using in-memory session store — active sessions will be lost on gateway restart. Configure session.provider=redis for persistence.');
  return new InMemorySessionStateStore();
}

function createPgPool(settings: StateStorePostgresConfig): Pool {
  return new pg.Pool({
    connectionString: settings.connectionString,
    ssl: settings.ssl,
    max: settings.maxConnections,
  });
}
