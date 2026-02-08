/**
 * State layer composition and policy-enforced operations.
 */

import { createRequire } from 'node:module';
import type { Pool } from 'pg';
import type {
  IdentityProfile,
  IdentityStore,
  MemoryEntry,
  MemoryFact,
  MemoryQuery,
  MemoryQueryResult,
  MemoryStore,
  PromptAssemblyResult,
  SessionStateRecord,
  SessionStateStore,
} from '@nachos/types';
import type { StateLayerConfig, StateLayerDependencies, StatePolicyRequest } from './types.js';
import { FilesystemIdentityStore } from './identity/filesystem-identity-store.js';
import { PostgresIdentityStore } from './identity/postgres-identity-store.js';
import { FilesystemMemoryStore } from './memory/filesystem-memory-store.js';
import { PostgresMemoryStore } from './memory/postgres-memory-store.js';
import {
  InMemorySessionStateStore,
  RedisSessionStateStore,
} from './session/redis-session-state-store.js';
import { PromptAssembler } from './prompt/prompt-assembler.js';
import type { PromptAssemblyParams } from './prompt/prompt-assembler.js';

export interface StateOperationContext {
  sessionId: string;
  userId?: string;
  securityMode: 'strict' | 'standard' | 'permissive';
  channel?: string;
}

export class StateLayer {
  private identityStore: IdentityStore;
  private memoryStore: MemoryStore;
  private sessionStateStore: SessionStateStore;
  private promptAssembler: PromptAssembler;
  private dependencies: StateLayerDependencies;

  constructor(params: {
    identityStore: IdentityStore;
    memoryStore: MemoryStore;
    sessionStateStore: SessionStateStore;
    promptAssembler: PromptAssembler;
    dependencies?: StateLayerDependencies;
  }) {
    this.identityStore = params.identityStore;
    this.memoryStore = params.memoryStore;
    this.sessionStateStore = params.sessionStateStore;
    this.promptAssembler = params.promptAssembler;
    this.dependencies = params.dependencies ?? {};
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
    await this.memoryStore.deleteEntry(id);
    await this.auditAllowed('state.memory.delete', context, agentId);
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
    const closers = [this.identityStore, this.memoryStore, this.sessionStateStore] as Array<{
      close?: () => Promise<void>;
    }>;
    for (const store of closers) {
      if (store.close) {
        await store.close();
      }
    }
  }

  private async ensureAllowed(
    action: string,
    context: StateOperationContext,
    resource?: string
  ): Promise<void> {
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
      throw new Error(decision.reason ?? `Policy denied ${action}`);
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

const require = createRequire(import.meta.url);

export function createStateLayer(
  config: StateLayerConfig,
  deps?: StateLayerDependencies
): StateLayer {
  const identityStore = createIdentityStore(config);
  const memoryStore = createMemoryStore(config);
  const sessionStore = createSessionStateStore(config);
  const promptAssembler = new PromptAssembler(config.prompt);

  return new StateLayer({
    identityStore,
    memoryStore,
    sessionStateStore: sessionStore,
    promptAssembler,
    dependencies: deps,
  });
}

function createIdentityStore(config: StateLayerConfig): IdentityStore {
  if (config.identity.provider === 'postgres') {
    const settings = config.identity.postgres;
    if (!settings?.connectionString) {
      throw new Error('Postgres identity store requires connectionString');
    }
    const pool = createPgPool(settings);
    return new PostgresIdentityStore(pool, settings.schema);
  }

  const dir = config.identity.filesystem?.dir;
  if (!dir) {
    throw new Error('Filesystem identity store requires dir');
  }
  return new FilesystemIdentityStore(dir);
}

function createMemoryStore(config: StateLayerConfig): MemoryStore {
  if (config.memory.provider === 'postgres') {
    const settings = config.memory.postgres;
    if (!settings?.connectionString) {
      throw new Error('Postgres memory store requires connectionString');
    }
    const pool = createPgPool(settings);
    return new PostgresMemoryStore(pool, settings.schema);
  }

  const dir = config.memory.filesystem?.dir;
  if (!dir) {
    throw new Error('Filesystem memory store requires dir');
  }
  return new FilesystemMemoryStore(dir);
}

function createSessionStateStore(config: StateLayerConfig): SessionStateStore {
  if (config.session.provider === 'redis') {
    const redisUrl = config.session.redisUrl;
    if (!redisUrl) {
      throw new Error('Redis session state store requires redisUrl');
    }
    return new RedisSessionStateStore(redisUrl, config.session.ttlSeconds);
  }

  return new InMemorySessionStateStore();
}

function createPgPool(settings: {
  connectionString: string;
  ssl?: boolean | Record<string, unknown>;
  maxConnections?: number;
}): Pool {
  const pg = require('pg') as typeof import('pg');
  return new pg.Pool({
    connectionString: settings.connectionString,
    ssl: settings.ssl,
    max: settings.maxConnections,
  });
}
