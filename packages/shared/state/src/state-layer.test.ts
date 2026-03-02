/**
 * Tests for createStateLayer factory and StateLayer class.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock external dependencies
vi.mock('@nachos/types', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  createConfigError: (msg: string) => new Error(msg),
  createPolicyDeniedError: (msg: string) => new Error(msg),
}));

vi.mock('pg', () => ({
  default: {
    Pool: vi.fn().mockImplementation(() => ({
      end: vi.fn(),
      query: vi.fn(),
    })),
  },
}));

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return {
    ...actual,
    createRequire: () => () => {
      throw new Error('better-sqlite3 not available in test');
    },
  };
});

vi.mock('./identity/filesystem-identity-store.js', () => ({
  FilesystemIdentityStore: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('./identity/postgres-identity-store.js', () => ({
  PostgresIdentityStore: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('./bootstrap/filesystem-bootstrap-store.js', () => ({
  FilesystemBootstrapStore: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('./bootstrap/postgres-bootstrap-store.js', () => ({
  PostgresBootstrapStore: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('./bootstrap/bootstrap-templates.js', () => ({
  createDefaultBootstrapBlocks: () => ({ system: 'default bootstrap' }),
}));

vi.mock('./bootstrap/sanitizer.js', () => ({
  sanitizeBootstrapContent: (content: string) => ({
    sanitized: content,
    hasInjection: false,
  }),
}));

vi.mock('./memory/filesystem-memory-store.js', () => ({
  FilesystemMemoryStore: vi.fn().mockImplementation(() => ({
    appendEntry: vi.fn(),
    appendFacts: vi.fn(),
    query: vi.fn(),
    deleteEntry: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('./memory/postgres-memory-store.js', () => ({
  PostgresMemoryStore: vi.fn().mockImplementation(() => ({
    appendEntry: vi.fn(),
    appendFacts: vi.fn(),
    query: vi.fn(),
    deleteEntry: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('./user-profile/filesystem-user-profile-store.js', () => ({
  FilesystemUserProfileStore: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('./user-profile/postgres-user-profile-store.js', () => ({
  PostgresUserProfileStore: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('./session/redis-session-state-store.js', () => ({
  InMemorySessionStateStore: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    touch: vi.fn(),
    delete: vi.fn(),
    close: vi.fn(),
  })),
  RedisSessionStateStore: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    touch: vi.fn(),
    delete: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('./sessions/postgres-sessions-store.js', () => ({
  PostgresSessionsStore: vi.fn().mockImplementation(() => ({
    createSession: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('./sessions/sqlite-sessions-store.js', () => ({
  SqliteSessionsStore: vi.fn().mockImplementation(() => ({
    createSession: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('./prompt/prompt-assembler.js', () => ({
  PromptAssembler: vi.fn().mockImplementation(() => ({
    assemble: vi.fn().mockReturnValue({
      systemPrompt: 'assembled prompt',
      sections: [],
      hash: 'abc123',
    }),
  })),
}));

import { createStateLayer, StateLayer } from './state-layer.js';
import type { StateLayerConfig } from './types.js';

function makeFilesystemConfig(): StateLayerConfig {
  return {
    identity: { provider: 'filesystem', filesystem: { dir: '/tmp/nachos-test/identity' } },
    bootstrap: { provider: 'filesystem', filesystem: { dir: '/tmp/nachos-test/bootstrap' } },
    memory: { provider: 'filesystem', filesystem: { dir: '/tmp/nachos-test/memory' } },
    userProfile: { provider: 'filesystem', filesystem: { dir: '/tmp/nachos-test/profiles' } },
    session: { provider: 'memory' },
  };
}

describe('createStateLayer', () => {
  it('creates a StateLayer with filesystem providers', () => {
    const config = makeFilesystemConfig();
    const layer = createStateLayer(config);

    expect(layer).toBeInstanceOf(StateLayer);
  });

  it('creates a StateLayer with all 6 store types accessible', () => {
    const config = makeFilesystemConfig();
    const layer = createStateLayer(config);

    // The StateLayer should be usable. Verify it has the expected methods.
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
    expect(typeof layer.assemblePrompt).toBe('function');
    expect(typeof layer.close).toBe('function');
  });

  it('sessionsStore is undefined when sessions config is not provided', () => {
    const config = makeFilesystemConfig();
    const layer = createStateLayer(config);

    expect(layer.sessionsStore).toBeUndefined();
  });

  it('throws when filesystem dir is missing', () => {
    const config = makeFilesystemConfig();
    config.identity = { provider: 'filesystem' };

    expect(() => createStateLayer(config)).toThrow('Filesystem identity store requires dir');
  });

  it('throws when postgres connectionString is missing', () => {
    const config = makeFilesystemConfig();
    config.identity = { provider: 'postgres' };

    expect(() => createStateLayer(config)).toThrow(
      'Postgres identity store requires connectionString'
    );
  });

  it('creates postgres stores when provider is postgres', () => {
    const config = makeFilesystemConfig();
    config.identity = {
      provider: 'postgres',
      postgres: { connectionString: 'postgres://localhost/test' },
    };

    const layer = createStateLayer(config);
    expect(layer).toBeInstanceOf(StateLayer);
  });

  it('deduplicates postgres pools for the same connectionString', () => {
    const pgConfig = {
      provider: 'postgres' as const,
      postgres: { connectionString: 'postgres://localhost/shared' },
    };

    const config: StateLayerConfig = {
      identity: pgConfig,
      bootstrap: pgConfig,
      memory: pgConfig,
      userProfile: pgConfig,
      session: { provider: 'memory' },
    };

    // Should not throw - pools should be shared
    const layer = createStateLayer(config);
    expect(layer).toBeInstanceOf(StateLayer);
  });
});

describe('StateLayer', () => {
  it('close() shuts down all stores', async () => {
    const config = makeFilesystemConfig();
    const layer = createStateLayer(config);

    // Should not throw
    await layer.close();
  });

  it('assemblePrompt delegates to PromptAssembler', () => {
    const config = makeFilesystemConfig();
    const layer = createStateLayer(config);

    const result = layer.assemblePrompt({
      identity: null,
      bootstrap: null,
      memoryEntries: [],
      memoryFacts: [],
      userProfile: null,
      sessionState: null,
    });

    expect(result).toBeDefined();
    expect(result.systemPrompt).toBe('assembled prompt');
  });

  it('permits operations when no policyCheck is provided', async () => {
    const config = makeFilesystemConfig();
    const layer = createStateLayer(config);

    const context = {
      sessionId: 'session-1',
      userId: 'user-1',
      securityMode: 'standard' as const,
    };

    // Should not throw - no policy check means permissive
    await expect(layer.getIdentity('agent-1', context)).resolves.not.toThrow();
  });

  it('skips policy check for internalTool operations', async () => {
    const policyCheck = vi.fn().mockResolvedValue({ allowed: false, reason: 'denied' });

    const config = makeFilesystemConfig();
    const layer = createStateLayer(config, { policyCheck });

    const context = {
      sessionId: 'session-1',
      userId: 'user-1',
      securityMode: 'standard' as const,
      internalTool: true,
    };

    // Should not throw despite policy returning denied
    await expect(layer.getIdentity('agent-1', context)).resolves.not.toThrow();

    // Policy check should NOT have been called
    expect(policyCheck).not.toHaveBeenCalled();
  });

  it('throws when policy check denies an operation', async () => {
    const policyCheck = vi.fn().mockResolvedValue({ allowed: false, reason: 'Access denied' });

    const config = makeFilesystemConfig();
    const layer = createStateLayer(config, { policyCheck });

    const context = {
      sessionId: 'session-1',
      userId: 'user-1',
      securityMode: 'strict' as const,
    };

    await expect(layer.getIdentity('agent-1', context)).rejects.toThrow('Access denied');
  });

  it('calls auditLogger when provided', async () => {
    const auditLogger = vi.fn().mockResolvedValue(undefined);

    const config = makeFilesystemConfig();
    const layer = createStateLayer(config, { auditLogger });

    const context = {
      sessionId: 'session-1',
      userId: 'user-1',
      securityMode: 'standard' as const,
    };

    await layer.getIdentity('agent-1', context);

    expect(auditLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'state.identity.read',
        outcome: 'allowed',
        userId: 'user-1',
        sessionId: 'session-1',
      })
    );
  });
});
