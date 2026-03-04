/**
 * Integration tests for the default state layer stack.
 *
 * These tests exercise createStateLayer() with real filesystem + SQLite
 * providers (no mocks) to verify all stores work together end-to-end.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStateLayer, type StateOperationContext } from './state-layer.js';
import type { StateLayerConfig } from './types.js';

const context: StateOperationContext = {
  sessionId: 'test-session',
  userId: 'test-user',
  securityMode: 'standard',
  internalTool: true,
};

describe('StateLayer default stack integration', () => {
  let tempDir: string;
  let layer: ReturnType<typeof createStateLayer>;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nachos-integ-'));

    const config: StateLayerConfig = {
      identity: {
        provider: 'filesystem',
        filesystem: { dir: path.join(tempDir, 'identity') },
      },
      bootstrap: {
        provider: 'filesystem',
        filesystem: { dir: path.join(tempDir, 'bootstrap') },
      },
      memory: {
        provider: 'filesystem',
        filesystem: { dir: path.join(tempDir, 'memory') },
      },
      userProfile: {
        provider: 'filesystem',
        filesystem: { dir: path.join(tempDir, 'profiles') },
      },
      session: { provider: 'memory' },
      sessions: {
        provider: 'sqlite',
        sqlite: { dbPath: ':memory:' },
      },
    };

    layer = createStateLayer(config);
    await layer.init();
  });

  afterAll(async () => {
    if (layer) {
      await layer.close();
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('createStateLayer() with filesystem config creates a functioning StateLayer', () => {
    expect(layer).toBeDefined();
    expect(typeof layer.getIdentity).toBe('function');
    expect(typeof layer.putIdentity).toBe('function');
    expect(typeof layer.getBootstrap).toBe('function');
    expect(typeof layer.putBootstrap).toBe('function');
    expect(typeof layer.appendMemoryEntry).toBe('function');
    expect(typeof layer.queryMemory).toBe('function');
    expect(typeof layer.getUserProfile).toBe('function');
    expect(typeof layer.putUserProfile).toBe('function');
    expect(typeof layer.getSessionState).toBe('function');
    expect(typeof layer.setSessionState).toBe('function');
    expect(typeof layer.close).toBe('function');
    expect(layer.sessionsStore).toBeDefined();
  });

  it('Identity: putIdentity() -> getIdentity() -> content matches', async () => {
    const profile = {
      agentId: 'integ-agent',
      soul: 'A helpful test assistant',
      identity: 'TestBot',
      userProfile: 'User prefers TypeScript',
      identityCompleted: true,
      updatedAt: new Date().toISOString(),
      version: 1,
    };

    const stored = await layer.putIdentity(profile, context);
    expect(stored.agentId).toBe('integ-agent');

    const retrieved = await layer.getIdentity('integ-agent', context);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.soul).toBe('A helpful test assistant');
    expect(retrieved!.identity).toBe('TestBot');
    expect(retrieved!.userProfile).toBe('User prefers TypeScript');
    expect(retrieved!.identityCompleted).toBe(true);
  });

  it('Bootstrap: getBootstrap() seeds defaults -> returns profile with content', async () => {
    // First call for a new agent should seed default bootstrap blocks
    const profile = await layer.getBootstrap('integ-bootstrap-agent', context);

    expect(profile).not.toBeNull();
    expect(profile!.agentId).toBe('integ-bootstrap-agent');
    expect(profile!.content).toBeDefined();
    // Default blocks include 'agents', 'soul', 'tools', etc.
    expect(typeof profile!.content.agents).toBe('string');
    expect(typeof profile!.content.soul).toBe('string');
    expect(typeof profile!.content.tools).toBe('string');
    expect(profile!.version).toBe(1);
  });

  it('Memory: appendMemoryEntry() -> queryMemory() -> retrieves the entry', async () => {
    const entry = {
      id: `entry-integ-${Date.now()}`,
      agentId: 'integ-agent',
      kind: 'summary' as const,
      content: 'Integration test memory entry',
      tags: ['test', 'integration'],
      createdAt: new Date().toISOString(),
    };

    const stored = await layer.appendMemoryEntry(entry, context);
    expect(stored.id).toBe(entry.id);

    const result = await layer.queryMemory({ agentId: 'integ-agent' }, context);
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
    const found = result.entries.find((e) => e.id === entry.id);
    expect(found).toBeDefined();
    expect(found!.content).toBe('Integration test memory entry');
    expect(found!.tags).toEqual(['test', 'integration']);
  });

  it('User profile: putUserProfile() -> getUserProfile() -> content matches', async () => {
    const profile = {
      userId: 'integ-user',
      agentId: 'integ-agent',
      profile: 'Prefers concise answers and TypeScript examples',
      updatedAt: new Date().toISOString(),
      version: 1,
    };

    const stored = await layer.putUserProfile(profile, context);
    expect(stored.userId).toBe('integ-user');

    const retrieved = await layer.getUserProfile('integ-agent', 'integ-user', context);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.profile).toBe('Prefers concise answers and TypeScript examples');
    expect(retrieved!.version).toBe(1);
  });

  it('Sessions (SQLite): create -> add messages -> list sessions -> verify', async () => {
    const sessionsStore = layer.sessionsStore;
    expect(sessionsStore).toBeDefined();

    // Create a session
    const session = await sessionsStore!.createSession({
      channel: 'test-channel',
      conversationId: 'integ-conv-1',
      userId: 'integ-user',
      systemPrompt: 'You are an integration test assistant',
    });

    expect(session.id).toBeDefined();
    expect(session.channel).toBe('test-channel');
    expect(session.status).toBe('active');

    // Add messages
    const msg1 = await sessionsStore!.addMessage({
      sessionId: session.id,
      role: 'user',
      content: 'Hello from integration test',
    });
    expect(msg1.content).toBe('Hello from integration test');

    const msg2 = await sessionsStore!.addMessage({
      sessionId: session.id,
      role: 'assistant',
      content: 'Hi there! Integration test response.',
    });
    expect(msg2.role).toBe('assistant');

    // List sessions
    const sessions = await sessionsStore!.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions.some((s) => s.id === session.id)).toBe(true);

    // Verify messages
    const messages = await sessionsStore!.getMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.content).toBe('Hello from integration test');
    expect(messages[1]!.content).toBe('Hi there! Integration test response.');

    // Verify session with messages
    const withMessages = await sessionsStore!.getSessionWithMessages(session.id);
    expect(withMessages).not.toBeNull();
    expect(withMessages!.messages).toHaveLength(2);
  });

  it('close() completes without error', async () => {
    // Create a fresh layer to test close() independently
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nachos-close-'));
    const config: StateLayerConfig = {
      identity: {
        provider: 'filesystem',
        filesystem: { dir: path.join(tmpDir, 'identity') },
      },
      bootstrap: {
        provider: 'filesystem',
        filesystem: { dir: path.join(tmpDir, 'bootstrap') },
      },
      memory: {
        provider: 'filesystem',
        filesystem: { dir: path.join(tmpDir, 'memory') },
      },
      userProfile: {
        provider: 'filesystem',
        filesystem: { dir: path.join(tmpDir, 'profiles') },
      },
      session: { provider: 'memory' },
      sessions: {
        provider: 'sqlite',
        sqlite: { dbPath: ':memory:' },
      },
    };

    const tempLayer = createStateLayer(config);
    await tempLayer.init();

    // Perform some operations to ensure stores are initialized
    await tempLayer.putIdentity(
      {
        agentId: 'close-test',
        soul: 'Test',
        identity: 'Test',
        userProfile: 'Test',
        identityCompleted: true,
        updatedAt: new Date().toISOString(),
        version: 1,
      },
      context
    );

    // close() should not throw
    await expect(tempLayer.close()).resolves.not.toThrow();

    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('missing optional config fields use sensible defaults (no crash)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nachos-defaults-'));

    // Minimal config with no optional fields (no sessions, no prompt config)
    const config: StateLayerConfig = {
      identity: {
        provider: 'filesystem',
        filesystem: { dir: path.join(tmpDir, 'identity') },
      },
      bootstrap: {
        provider: 'filesystem',
        filesystem: { dir: path.join(tmpDir, 'bootstrap') },
      },
      memory: {
        provider: 'filesystem',
        filesystem: { dir: path.join(tmpDir, 'memory') },
      },
      userProfile: {
        provider: 'filesystem',
        filesystem: { dir: path.join(tmpDir, 'profiles') },
      },
      session: { provider: 'memory' },
      // No sessions config
      // No prompt config
    };

    const minimalLayer = createStateLayer(config);

    // Should not crash
    expect(minimalLayer).toBeDefined();

    // sessionsStore should be undefined
    expect(minimalLayer.sessionsStore).toBeUndefined();

    // assemblePrompt should work with defaults
    const result = minimalLayer.assemblePrompt({
      basePrompt: 'Hello',
    });
    expect(result).toBeDefined();
    expect(result.prompt).toBeDefined();

    // Basic operations should work
    const identity = await minimalLayer.getIdentity('no-exist', context);
    expect(identity).toBeNull();

    await minimalLayer.close();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('session state: set -> get -> touch -> delete lifecycle works', async () => {
    const record = {
      sessionId: 'integ-state-session',
      agentId: 'integ-agent',
      state: { topic: 'testing', turn: 1 },
      updatedAt: new Date().toISOString(),
    };

    const stored = await layer.setSessionState(record, context);
    expect(stored.sessionId).toBe('integ-state-session');

    const retrieved = await layer.getSessionState('integ-state-session', context);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.state.topic).toBe('testing');

    // touch should not throw
    await expect(layer.touchSessionState('integ-state-session', context)).resolves.not.toThrow();

    // delete
    await layer.deleteSessionState('integ-state-session', context);
    const afterDelete = await layer.getSessionState('integ-state-session', context);
    expect(afterDelete).toBeNull();
  });
});
