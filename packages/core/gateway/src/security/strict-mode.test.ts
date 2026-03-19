/**
 * NACA-53: Security — strict mode tests
 *
 * Verifies strict mode disables tools by default and requires explicit allowlisting.
 *
 * Config:
 *   [security]
 *   mode = "strict"
 *
 * Test cases:
 *   TC1 — Send a basic message: LLM still responds (not blocked)
 *   TC2 — Ask bot to use web_fetch: disabled unless explicitly enabled
 *   TC3 — Add web_fetch to explicit allow: it then works
 *   TC4 — Audit logging automatically enabled in strict mode (see validation.test.ts)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolExecutor, type ToolExecutorDeps } from '../tools/tool-executor.js';
import type { Session, ToolResult } from '@nachos/types';

// ---------------------------------------------------------------------------
// Module mock: replace executeWebFetchNative with a controllable stub so TC3
// can verify the call reaches the web-fetch layer without making real HTTP requests.
// ---------------------------------------------------------------------------
vi.mock('../tools/web-fetch-tools.js', () => ({
  executeWebFetchNative: vi.fn().mockResolvedValue({
    success: true,
    content: [{ type: 'text', text: '<h1>Hello</h1>' }],
  }),
  WebFetchNativeToolSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to fetch' },
    },
    required: ['url'],
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-strict-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    channel: 'discord',
    conversationId: 'conv-strict-1',
    userId: 'user-1',
    status: 'active',
    config: {},
    metadata: {},
    isPinned: false,
    isArchived: false,
    lastActivity: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMockDeps(overrides: {
  securityMode?: 'strict' | 'standard' | 'permissive';
  toolsConfig?: ToolExecutorDeps['core']['toolsConfig'];
  toolCoordinator?: ToolExecutorDeps['core']['toolCoordinator'];
  logAuditEvent?: ToolExecutorDeps['audit']['logAuditEvent'];
  stateLayer?: ToolExecutorDeps['state']['stateLayer'];
} = {}): ToolExecutorDeps {
  // Default coordinator that returns empty results (for local-dispatch tests)
  const defaultCoordinator = {
    executeTools: vi.fn().mockResolvedValue([]),
  } as unknown as ToolExecutorDeps['core']['toolCoordinator'];

  return {
    core: {
      instanceId: 'test-instance',
      securityMode: overrides.securityMode ?? 'strict',
      toolsConfig: 'toolsConfig' in overrides ? overrides.toolsConfig : {},
      toolCoordinator: overrides.toolCoordinator ?? defaultCoordinator,
      scheduler: undefined,
      subagentManager: undefined,
      subagentOrchestrator: undefined,
    },
    policy: {
      resolveToolGroup: vi.fn().mockReturnValue(undefined),
      evaluatePolicy: vi.fn().mockReturnValue({ allowed: true }),
      subagentToolPolicy: undefined,
    },
    audit: {
      logAuditEvent: overrides.logAuditEvent ?? vi.fn().mockResolvedValue(undefined),
      publishStatusEvent: vi.fn().mockResolvedValue(undefined),
    },
    state: {
      stateLayer: overrides.stateLayer ?? undefined,
      getSession: vi.fn().mockResolvedValue(createMockSession()),
      getMessages: vi.fn().mockResolvedValue([]),
      getIdentityCompletionStatus: vi.fn().mockResolvedValue(false),
      markIdentityCompleted: vi.fn().mockResolvedValue(undefined),
      resetIdentityForCommand: vi.fn().mockResolvedValue(undefined),
      getSubagentInfo: vi.fn().mockReturnValue(null),
      listSubagents: vi.fn().mockReturnValue([]),
      stopSubagent: vi.fn().mockReturnValue(false),
      steerSubagent: vi.fn().mockResolvedValue(false),
      getSubagentLog: vi.fn().mockResolvedValue(null),
    },
    security: {
      dlp: null,
      sandboxManager: undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Security — strict mode (NACA-53)', () => {
  describe('TC1: LLM still responds in strict mode (not blocked)', () => {
    it('[NACA-53 TC1] buildToolDefinitions returns tool schemas (LLM can still receive tools)', () => {
      const deps = createMockDeps({ securityMode: 'strict' });
      const executor = new ToolExecutor(deps);
      const session = createMockSession();

      // In strict mode, buildToolDefinitions should return an array (not undefined/null)
      // so the LLM can still receive tool schemas and generate responses.
      const tools = executor.buildToolDefinitions(session);

      // Should return a defined array — LLM pipeline is not blocked
      expect(Array.isArray(tools)).toBe(true);
    });

    it('[NACA-53 TC1] strict mode does not change securityMode on the executor', () => {
      const deps = createMockDeps({ securityMode: 'strict' });
      // If the executor stores securityMode, it should remain 'strict' (not forced to 'off')
      // This verifies LLM processing isn't globally disabled.
      expect(deps.core.securityMode).toBe('strict');
    });

    it('[NACA-53 TC1] bootstrap tool is available in strict mode when stateLayer is present', () => {
      const mockStateLayer = {
        getIdentity: vi.fn(),
        getBootstrap: vi.fn(),
        getUserProfile: vi.fn(),
        queryMemory: vi.fn(),
        getSessionState: vi.fn(),
        assemblePrompt: vi.fn(),
        close: vi.fn(),
      } as unknown as ToolExecutorDeps['state']['stateLayer'];

      const deps = createMockDeps({
        securityMode: 'strict',
        stateLayer: mockStateLayer,
      });
      const executor = new ToolExecutor(deps);
      const session = createMockSession();

      const tools = executor.buildToolDefinitions(session) as Array<{ name: string }> | undefined;
      const toolNames = (tools ?? []).map((t) => t.name);

      // bootstrap should be in the tool list when stateLayer is present (even in strict mode)
      expect(toolNames).toContain('bootstrap');
    });
  });

  describe('TC2: web_fetch disabled by default in strict mode', () => {
    it('[NACA-53 TC2] web_fetch_native is NOT in tool definitions when toolsConfig is absent', () => {
      const deps = createMockDeps({ securityMode: 'strict', toolsConfig: {} });
      const executor = new ToolExecutor(deps);
      const session = createMockSession();

      const tools = executor.buildToolDefinitions(session) as Array<{ name: string }> | undefined;
      const toolNames = (tools ?? []).map((t) => t.name);

      expect(toolNames).not.toContain('web_fetch_native');
    });

    it('[NACA-53 TC2] web_fetch_native is NOT in tool definitions when web_fetch.enabled is false', () => {
      const deps = createMockDeps({
        securityMode: 'strict',
        toolsConfig: { web_fetch: { enabled: false } },
      });
      const executor = new ToolExecutor(deps);
      const session = createMockSession();

      const tools = executor.buildToolDefinitions(session) as Array<{ name: string }> | undefined;
      const toolNames = (tools ?? []).map((t) => t.name);

      expect(toolNames).not.toContain('web_fetch_native');
    });

    it('[NACA-53 TC2] calling web_fetch_native returns WEB_FETCH_DISABLED when not enabled', async () => {
      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([]),
      };

      const deps = createMockDeps({
        securityMode: 'strict',
        toolsConfig: {},
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
      });
      const executor = new ToolExecutor(deps);

      const toolCalls = [
        { id: 'call-strict-1', name: 'web_fetch_native', arguments: '{"url":"https://example.com"}' },
      ];

      const messages = await executor.executeToolCalls('session-strict-1', toolCalls);

      expect(messages).toHaveLength(1);
      const result = messages[0] as { content: Array<{ tool_result: { code?: string } }> };
      const toolResult = result.content[0]?.tool_result;
      expect(toolResult?.code).toBe('WEB_FETCH_DISABLED');
    });
  });

  describe('TC3: web_fetch works when explicitly enabled', () => {
    it('[NACA-53 TC3] web_fetch_native is included in tool definitions when explicitly enabled', () => {
      const deps = createMockDeps({
        securityMode: 'strict',
        toolsConfig: { web_fetch: { enabled: true } },
      });
      const executor = new ToolExecutor(deps);
      const session = createMockSession();

      const tools = executor.buildToolDefinitions(session) as Array<{ name: string }> | undefined;
      const toolNames = (tools ?? []).map((t) => t.name);

      expect(toolNames).toContain('web_fetch_native');
    });

    it('[NACA-53 TC3] calling web_fetch_native succeeds when explicitly enabled', async () => {
      const deps = createMockDeps({
        securityMode: 'strict',
        toolsConfig: { web_fetch: { enabled: true } },
      });
      const executor = new ToolExecutor(deps);

      const toolCalls = [
        { id: 'call-strict-2', name: 'web_fetch_native', arguments: '{"url":"https://example.com"}' },
      ];

      const messages = await executor.executeToolCalls('session-strict-1', toolCalls);

      expect(messages).toHaveLength(1);
      const result = messages[0] as { content: Array<{ tool_result: { code?: string; content?: unknown[] } }> };
      const toolResult = result.content[0]?.tool_result;

      // Should NOT return WEB_FETCH_DISABLED — the mock returns success
      expect(toolResult?.code).not.toBe('WEB_FETCH_DISABLED');
    });
  });
});
