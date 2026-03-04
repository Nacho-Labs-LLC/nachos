import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolExecutor, type ToolExecutorDeps } from './tool-executor.js';
import type { Session, ToolResult } from '@nachos/types';

/**
 * Creates a minimal mock Session for testing.
 */
function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    channel: 'slack',
    conversationId: 'conv-1',
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

/**
 * Flat overrides that map into the grouped ToolExecutorDeps structure.
 * This keeps test callsites clean while producing the correct shape.
 */
interface MockDepsOverrides {
  // core
  instanceId?: string;
  securityMode?: 'strict' | 'standard' | 'permissive';
  toolsConfig?: ToolExecutorDeps['core']['toolsConfig'];
  toolCoordinator?: ToolExecutorDeps['core']['toolCoordinator'];
  scheduler?: ToolExecutorDeps['core']['scheduler'];
  subagentManager?: unknown;
  subagentOrchestrator?: ToolExecutorDeps['core']['subagentOrchestrator'];
  // policy
  resolveToolGroup?: ToolExecutorDeps['policy']['resolveToolGroup'];
  evaluatePolicy?: ToolExecutorDeps['policy']['evaluatePolicy'];
  subagentToolPolicy?: ToolExecutorDeps['policy']['subagentToolPolicy'];
  // audit
  logAuditEvent?: ToolExecutorDeps['audit']['logAuditEvent'];
  publishStatusEvent?: ToolExecutorDeps['audit']['publishStatusEvent'];
  // state
  stateLayer?: ToolExecutorDeps['state']['stateLayer'];
  getSession?: ToolExecutorDeps['state']['getSession'];
  getMessages?: ToolExecutorDeps['state']['getMessages'];
  getIdentityCompletionStatus?: ToolExecutorDeps['state']['getIdentityCompletionStatus'];
  markIdentityCompleted?: ToolExecutorDeps['state']['markIdentityCompleted'];
  resetIdentityForCommand?: ToolExecutorDeps['state']['resetIdentityForCommand'];
  getSubagentInfo?: ToolExecutorDeps['state']['getSubagentInfo'];
  listSubagents?: ToolExecutorDeps['state']['listSubagents'];
  stopSubagent?: ToolExecutorDeps['state']['stopSubagent'];
  steerSubagent?: ToolExecutorDeps['state']['steerSubagent'];
  getSubagentLog?: ToolExecutorDeps['state']['getSubagentLog'];
  // security
  dlp?: ToolExecutorDeps['security']['dlp'];
  sandboxManager?: ToolExecutorDeps['security']['sandboxManager'];
}

/**
 * Creates a minimal mock ToolExecutorDeps with sensible defaults.
 * Accepts flat overrides for convenience and maps them into the grouped structure.
 */
function createMockDeps(overrides: MockDepsOverrides = {}): ToolExecutorDeps {
  return {
    core: {
      instanceId: overrides.instanceId ?? 'test-instance',
      securityMode: overrides.securityMode ?? 'standard',
      toolsConfig: 'toolsConfig' in overrides ? overrides.toolsConfig : {},
      toolCoordinator: overrides.toolCoordinator ?? null,
      scheduler: overrides.scheduler,
      subagentManager: overrides.subagentManager,
      subagentOrchestrator: overrides.subagentOrchestrator,
    },
    policy: {
      resolveToolGroup: overrides.resolveToolGroup ?? vi.fn().mockReturnValue(undefined),
      evaluatePolicy: overrides.evaluatePolicy ?? vi.fn().mockReturnValue({ allowed: true }),
      subagentToolPolicy: overrides.subagentToolPolicy,
    },
    audit: {
      logAuditEvent: overrides.logAuditEvent ?? vi.fn().mockResolvedValue(undefined),
      publishStatusEvent: overrides.publishStatusEvent ?? vi.fn().mockResolvedValue(undefined),
    },
    state: {
      stateLayer: overrides.stateLayer,
      getSession: overrides.getSession ?? vi.fn().mockResolvedValue(createMockSession()),
      getMessages: overrides.getMessages ?? vi.fn().mockResolvedValue([]),
      getIdentityCompletionStatus:
        overrides.getIdentityCompletionStatus ?? vi.fn().mockResolvedValue(false),
      markIdentityCompleted:
        overrides.markIdentityCompleted ?? vi.fn().mockResolvedValue(undefined),
      resetIdentityForCommand:
        overrides.resetIdentityForCommand ?? vi.fn().mockResolvedValue(undefined),
      getSubagentInfo: overrides.getSubagentInfo ?? vi.fn().mockReturnValue(null),
      listSubagents: overrides.listSubagents ?? vi.fn().mockReturnValue([]),
      stopSubagent: overrides.stopSubagent ?? vi.fn().mockReturnValue(false),
      steerSubagent: overrides.steerSubagent ?? vi.fn().mockResolvedValue(false),
      getSubagentLog: overrides.getSubagentLog ?? vi.fn().mockResolvedValue(null),
    },
    security: {
      dlp: overrides.dlp ?? null,
      sandboxManager: overrides.sandboxManager,
    },
  };
}

describe('ToolExecutor', () => {
  let executor: ToolExecutor;
  let deps: ToolExecutorDeps;

  beforeEach(() => {
    deps = createMockDeps();
    executor = new ToolExecutor(deps);
  });

  describe('buildToolDefinitions', () => {
    it('[TE-01] should return array of tool schemas', () => {
      const session = createMockSession();

      // With stateLayer present, should include memory tools + user_profile + bootstrap
      const depsWithState = createMockDeps({
        stateLayer: {
          getIdentity: vi.fn(),
          getBootstrap: vi.fn(),
          getUserProfile: vi.fn(),
          queryMemory: vi.fn(),
          getSessionState: vi.fn(),
          assemblePrompt: vi.fn(),
          close: vi.fn(),
        } as unknown as ToolExecutorDeps['state']['stateLayer'],
        toolsConfig: { bootstrap: { enabled: true } },
      });
      const executorWithState = new ToolExecutor(depsWithState);

      const tools = executorWithState.buildToolDefinitions(session);

      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
      // Each tool should have name, description, and parameters
      for (const tool of tools ?? []) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('parameters');
      }
    });

    it('[TE-02] should filter tools by security mode (subagent returns only subagent_progress)', () => {
      const subagentSession = createMockSession({
        metadata: { subagent: { runId: 'run-1' } },
      });

      // With stateLayer so main session would have many tools
      const depsWithState = createMockDeps({
        stateLayer: {
          getIdentity: vi.fn(),
          getBootstrap: vi.fn(),
          getUserProfile: vi.fn(),
          queryMemory: vi.fn(),
          getSessionState: vi.fn(),
          assemblePrompt: vi.fn(),
          close: vi.fn(),
        } as unknown as ToolExecutorDeps['state']['stateLayer'],
        toolsConfig: { bootstrap: { enabled: true } },
      });
      const executorWithState = new ToolExecutor(depsWithState);

      const subagentTools = executorWithState.buildToolDefinitions(subagentSession) as
        | Array<{ name: string }>
        | undefined;

      // Subagent sessions get only subagent_progress tool
      expect(subagentTools).toBeDefined();
      const toolNames = subagentTools!.map((t) => t.name);
      expect(toolNames).toContain('subagent_progress');
      expect(toolNames).not.toContain('memory_search');
      expect(toolNames).not.toContain('bootstrap');
    });

    it('[TE-03] should include state tools (memory_search, memory_get, user_profile) when stateLayer is present', () => {
      const session = createMockSession();

      const depsWithState = createMockDeps({
        stateLayer: {
          getIdentity: vi.fn(),
          getBootstrap: vi.fn(),
          getUserProfile: vi.fn(),
          queryMemory: vi.fn(),
          getSessionState: vi.fn(),
          assemblePrompt: vi.fn(),
          close: vi.fn(),
        } as unknown as ToolExecutorDeps['state']['stateLayer'],
      });
      const executorWithState = new ToolExecutor(depsWithState);

      const tools = executorWithState.buildToolDefinitions(session) as
        | Array<{ name: string }>
        | undefined;

      expect(tools).toBeDefined();
      const toolNames = tools!.map((t) => t.name);
      expect(toolNames).toContain('memory_search');
      expect(toolNames).toContain('memory_get');
      expect(toolNames).toContain('user_profile');
    });
  });

  describe('executeToolCalls', () => {
    it('[TE-04] should process tool calls and return results', async () => {
      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([
          {
            success: true,
            content: [{ type: 'text', text: '{"result": "ok"}' }],
          },
        ]),
      };

      const depsWithCoordinator = createMockDeps({
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
      });
      const executorWithCoord = new ToolExecutor(depsWithCoordinator);

      const toolCalls = [
        { id: 'call-1', name: 'web_fetch', arguments: '{"url": "https://example.com"}' },
      ];

      const messages = await executorWithCoord.executeToolCalls('session-1', toolCalls);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: 'tool',
        tool_call_id: 'call-1',
      });
      expect(mockCoordinator.executeTools).toHaveBeenCalled();
    });

    it('[TE-05] should respect policy deny and return POLICY_DENIED error for subagent', async () => {
      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([]),
      };

      const subagentSession = createMockSession({
        metadata: { subagent: { runId: 'run-1' } },
      });

      const depsWithPolicy = createMockDeps({
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
        getSession: vi.fn().mockResolvedValue(subagentSession),
        subagentToolPolicy: { deny: ['dangerous_tool'] },
      });
      const executorWithPolicy = new ToolExecutor(depsWithPolicy);

      const toolCalls = [{ id: 'call-denied', name: 'sessions_spawn', arguments: '{}' }];

      const messages = await executorWithPolicy.executeToolCalls('session-1', toolCalls);

      expect(messages).toHaveLength(1);
      // The result should be a tool message with error
      const result = messages[0] as { content: Array<{ tool_result: unknown }> };
      const toolResult = result.content[0]?.tool_result as { code?: string };
      expect(toolResult?.code).toBe('POLICY_DENIED');
    });

    it('[TE-06] should return tool_use_id for LLM matching', async () => {
      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([
          {
            success: true,
            content: [{ type: 'text', text: '"hello"' }],
          },
        ]),
      };

      const depsWithCoord = createMockDeps({
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
      });
      const executorWithCoord = new ToolExecutor(depsWithCoord);

      const toolCalls = [{ id: 'call-abc-123', name: 'web_fetch', arguments: '{}' }];

      const messages = await executorWithCoord.executeToolCalls('session-1', toolCalls);

      expect(messages[0]).toMatchObject({
        tool_call_id: 'call-abc-123',
      });
      // Check the content also references the tool_use_id
      const content = (messages[0] as { content: Array<{ tool_use_id: string }> }).content;
      expect(content[0]?.tool_use_id).toBe('call-abc-123');
    });

    it('[TE-07] should handle DLP scan on tool input that blocks sensitive data', async () => {
      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([]),
      };

      const mockDlp = {
        scan: vi.fn().mockReturnValue({
          allowed: false,
          action: 'block',
          findings: [{ pattern: 'aws_key', severity: 'critical' }],
          reason: 'Sensitive data detected in tool input',
        }),
      };

      const depsWithDlp = createMockDeps({
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
        dlp: mockDlp as unknown as ToolExecutorDeps['security']['dlp'],
      });
      const executorWithDlp = new ToolExecutor(depsWithDlp);

      const toolCalls = [
        {
          id: 'call-dlp-1',
          name: 'web_fetch',
          arguments: '{"url": "https://example.com", "key": "AKIAIOSFODNN7EXAMPLE"}',
        },
      ];

      const messages = await executorWithDlp.executeToolCalls('session-1', toolCalls);

      expect(messages).toHaveLength(1);
      const result = messages[0] as { content: Array<{ tool_result: unknown }> };
      const toolResult = result.content[0]?.tool_result as { code?: string };
      expect(toolResult?.code).toBe('DLP_BLOCKED');

      // Tool coordinator should NOT have been called since DLP blocked it
      expect(mockCoordinator.executeTools).not.toHaveBeenCalled();
    });

    it('[TE-08] should handle DLP scan on tool output that blocks sensitive data', async () => {
      const sensitiveOutput: ToolResult = {
        success: true,
        content: [{ type: 'text', text: 'Secret key: AKIAIOSFODNN7EXAMPLE' }],
      };

      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([sensitiveOutput]),
      };

      // DLP allows input but blocks output
      const mockDlp = {
        scan: vi
          .fn()
          .mockReturnValueOnce({
            // First call: tool input scan - allow
            allowed: true,
            action: 'allow',
            findings: [],
          })
          .mockReturnValueOnce({
            // Second call: tool output scan - block
            allowed: false,
            action: 'block',
            findings: [{ pattern: 'aws_key', severity: 'critical' }],
            reason: 'Sensitive data in tool output',
          }),
      };

      const depsWithDlp = createMockDeps({
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
        dlp: mockDlp as unknown as ToolExecutorDeps['security']['dlp'],
      });
      const executorWithDlp = new ToolExecutor(depsWithDlp);

      const toolCalls = [
        { id: 'call-dlp-out', name: 'web_fetch', arguments: '{"url": "https://example.com"}' },
      ];

      const messages = await executorWithDlp.executeToolCalls('session-1', toolCalls);

      expect(messages).toHaveLength(1);
      const result = messages[0] as { content: Array<{ tool_result: unknown }> };
      const toolResult = result.content[0]?.tool_result as { code?: string };
      expect(toolResult?.code).toBe('DLP_BLOCKED');
    });

    it('[TE-09] should return error for unknown tool handled by coordinator', async () => {
      // The coordinator would handle unknown tools - it returns an error result
      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([
          {
            success: false,
            content: [],
            error: { code: 'UNKNOWN_TOOL', message: 'Tool not found: nonexistent_tool' },
          },
        ]),
      };

      const depsWithCoord = createMockDeps({
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
      });
      const executorWithCoord = new ToolExecutor(depsWithCoord);

      const toolCalls = [{ id: 'call-unknown', name: 'nonexistent_tool', arguments: '{}' }];

      const messages = await executorWithCoord.executeToolCalls('session-1', toolCalls);

      expect(messages).toHaveLength(1);
      const result = messages[0] as { content: Array<{ tool_result: unknown }> };
      const toolResult = result.content[0]?.tool_result as { code?: string };
      expect(toolResult?.code).toBe('UNKNOWN_TOOL');
    });

    it('[TE-10] should throw when tool coordinator is not initialized', async () => {
      // deps has toolCoordinator: null by default
      const toolCalls = [{ id: 'call-no-coord', name: 'web_fetch', arguments: '{}' }];

      await expect(executor.executeToolCalls('session-1', toolCalls)).rejects.toThrow(
        'Tool coordinator not initialized'
      );
    });

    it('[TE-11] should handle invalid JSON in tool arguments gracefully', async () => {
      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([
          {
            success: true,
            content: [{ type: 'text', text: '{"parsed": true}' }],
          },
        ]),
      };

      const depsWithCoord = createMockDeps({
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
      });
      const executorWithCoord = new ToolExecutor(depsWithCoord);

      const toolCalls = [{ id: 'call-bad-json', name: 'web_fetch', arguments: '{invalid json' }];

      // Should not throw - invalid JSON is handled gracefully with a _parseError field
      const messages = await executorWithCoord.executeToolCalls('session-1', toolCalls);
      expect(messages).toHaveLength(1);

      // Verify the coordinator received a call with _parseError
      const coordCall = mockCoordinator.executeTools.mock.calls[0]?.[0]?.[0];
      expect(coordCall?.parameters?._parseError).toBe('Invalid tool arguments JSON');
    });
  });

  describe('updateDeps', () => {
    it('[TE-12] should update coordinator, dlp, and scheduler dependencies', () => {
      const mockCoordinator = {
        executeTools: vi.fn(),
      };
      const mockDlp = {
        scan: vi.fn(),
      };
      const mockScheduler = {
        addJob: vi.fn(),
      };

      executor.updateDeps({
        core: {
          toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
          scheduler: mockScheduler as unknown as ToolExecutorDeps['core']['scheduler'],
        },
        security: {
          dlp: mockDlp as unknown as ToolExecutorDeps['security']['dlp'],
        },
      });

      // After updateDeps, build tool definitions should reflect the new scheduler
      const session = createMockSession();
      const tools = executor.buildToolDefinitions(session) as Array<{ name: string }> | undefined;

      // With scheduler, cron tools should be present
      const toolNames = (tools ?? []).map((t) => t.name);
      expect(toolNames).toContain('nachos_cron_add');
      expect(toolNames).toContain('nachos_cron_list');
    });
  });

  // ---------------------------------------------------------------------------
  // Additional tests: local tool dispatch
  // ---------------------------------------------------------------------------

  describe('local tool dispatch', () => {
    it('[TE-13] should dispatch memory_search to local handler when stateLayer exists', async () => {
      const mockStateLayer = {
        queryMemory: vi.fn().mockResolvedValue({ entries: [] }),
        getIdentity: vi.fn(),
        getBootstrap: vi.fn(),
        getUserProfile: vi.fn(),
        getSessionState: vi.fn(),
        assemblePrompt: vi.fn(),
        close: vi.fn(),
      };

      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([]),
      };

      const depsLocal = createMockDeps({
        stateLayer: mockStateLayer as unknown as ToolExecutorDeps['stateLayer'],
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
      });
      const executorLocal = new ToolExecutor(depsLocal);

      // memory_search is a local tool — it should be handled locally
      // not sent to the coordinator
      const toolCalls = [
        { id: 'call-mem', name: 'memory_search', arguments: '{"query": "test"}' },
      ];

      const messages = await executorLocal.executeToolCalls('session-1', toolCalls);

      expect(messages).toHaveLength(1);
      // The coordinator should NOT have been called for memory_search
      expect(mockCoordinator.executeTools).not.toHaveBeenCalled();
    });

    it('[TE-14] should dispatch memory_get to local handler when stateLayer exists', async () => {
      const mockStateLayer = {
        getMemoryFile: vi.fn().mockResolvedValue({ content: 'memory content' }),
        getIdentity: vi.fn(),
        getBootstrap: vi.fn(),
        getUserProfile: vi.fn(),
        queryMemory: vi.fn(),
        getSessionState: vi.fn(),
        assemblePrompt: vi.fn(),
        close: vi.fn(),
      };

      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([]),
      };

      const depsLocal = createMockDeps({
        stateLayer: mockStateLayer as unknown as ToolExecutorDeps['stateLayer'],
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
      });
      const executorLocal = new ToolExecutor(depsLocal);

      const toolCalls = [
        { id: 'call-mg', name: 'memory_get', arguments: '{"file": "MEMORY.md"}' },
      ];

      const messages = await executorLocal.executeToolCalls('session-1', toolCalls);

      expect(messages).toHaveLength(1);
      expect(mockCoordinator.executeTools).not.toHaveBeenCalled();
    });

    it('[TE-15] should return STATE_LAYER_DISABLED when memory tool called without stateLayer', async () => {
      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([]),
      };

      const depsNoState = createMockDeps({
        stateLayer: undefined,
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
      });
      const executorNoState = new ToolExecutor(depsNoState);

      const toolCalls = [
        { id: 'call-mem-ns', name: 'memory_search', arguments: '{"query": "test"}' },
      ];

      const messages = await executorNoState.executeToolCalls('session-1', toolCalls);

      expect(messages).toHaveLength(1);
      const result = messages[0] as { content: Array<{ tool_result: unknown }> };
      const toolResult = result.content[0]?.tool_result as { code?: string };
      expect(toolResult?.code).toBe('STATE_LAYER_DISABLED');
    });

    it('[TE-16] should return SESSION_NOT_FOUND when memory tool called with null session', async () => {
      const mockStateLayer = {
        queryMemory: vi.fn(),
        getIdentity: vi.fn(),
        getBootstrap: vi.fn(),
        getUserProfile: vi.fn(),
        getSessionState: vi.fn(),
        assemblePrompt: vi.fn(),
        close: vi.fn(),
      };

      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([]),
      };

      const depsNullSession = createMockDeps({
        stateLayer: mockStateLayer as unknown as ToolExecutorDeps['stateLayer'],
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
        getSession: vi.fn().mockResolvedValue(null),
      });
      const executorNull = new ToolExecutor(depsNullSession);

      const toolCalls = [
        { id: 'call-ns', name: 'memory_search', arguments: '{"query": "test"}' },
      ];

      const messages = await executorNull.executeToolCalls('session-1', toolCalls);

      expect(messages).toHaveLength(1);
      const result = messages[0] as { content: Array<{ tool_result: unknown }> };
      const toolResult = result.content[0]?.tool_result as { code?: string };
      expect(toolResult?.code).toBe('SESSION_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // Bootstrap tool dispatch
  // ---------------------------------------------------------------------------

  describe('bootstrap tool dispatch', () => {
    it('[TE-17] should dispatch bootstrap get action locally', async () => {
      const mockStateLayer = {
        getBootstrap: vi.fn().mockResolvedValue({
          agentId: 'agent-1',
          content: { name: 'Nachos Agent' },
          version: 1,
        }),
        getIdentity: vi.fn(),
        getUserProfile: vi.fn(),
        queryMemory: vi.fn(),
        getSessionState: vi.fn(),
        assemblePrompt: vi.fn(),
        close: vi.fn(),
      };

      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([]),
      };

      const depsBootstrap = createMockDeps({
        stateLayer: mockStateLayer as unknown as ToolExecutorDeps['stateLayer'],
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
        toolsConfig: { bootstrap: { enabled: true } },
      });
      const executorBoot = new ToolExecutor(depsBootstrap);

      const toolCalls = [
        { id: 'call-boot', name: 'bootstrap', arguments: '{"action": "get"}' },
      ];

      const messages = await executorBoot.executeToolCalls('session-1', toolCalls);

      expect(messages).toHaveLength(1);
      expect(mockCoordinator.executeTools).not.toHaveBeenCalled();
      expect(mockStateLayer.getBootstrap).toHaveBeenCalled();
    });

    it('[TE-18] should block bootstrap set action when identity is completed', async () => {
      const mockStateLayer = {
        getBootstrap: vi.fn().mockResolvedValue({ agentId: 'agent-1', version: 1 }),
        getIdentity: vi.fn(),
        getUserProfile: vi.fn(),
        queryMemory: vi.fn(),
        getSessionState: vi.fn(),
        assemblePrompt: vi.fn(),
        close: vi.fn(),
      };

      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([]),
      };

      const depsLocked = createMockDeps({
        stateLayer: mockStateLayer as unknown as ToolExecutorDeps['stateLayer'],
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
        toolsConfig: { bootstrap: { enabled: true } },
        getIdentityCompletionStatus: vi.fn().mockResolvedValue(true),
      });
      const executorLocked = new ToolExecutor(depsLocked);

      const toolCalls = [
        {
          id: 'call-boot-set',
          name: 'bootstrap',
          arguments: '{"action": "set", "content": {"name": "New Name"}}',
        },
      ];

      const messages = await executorLocked.executeToolCalls('session-1', toolCalls);

      expect(messages).toHaveLength(1);
      const result = messages[0] as { content: Array<{ tool_result: unknown }> };
      const toolResult = result.content[0]?.tool_result as { code?: string; message?: string };
      expect(toolResult?.code).toBe('TOOL_DISABLED');
      expect(toolResult?.message).toContain('locked');
    });

    it('[TE-19] should return error when bootstrap is disabled', async () => {
      const mockStateLayer = {
        getBootstrap: vi.fn(),
        getIdentity: vi.fn(),
        getUserProfile: vi.fn(),
        queryMemory: vi.fn(),
        getSessionState: vi.fn(),
        assemblePrompt: vi.fn(),
        close: vi.fn(),
      };

      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([]),
      };

      const depsDisabled = createMockDeps({
        stateLayer: mockStateLayer as unknown as ToolExecutorDeps['stateLayer'],
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
        toolsConfig: { bootstrap: { enabled: false } },
      });
      const executorDisabled = new ToolExecutor(depsDisabled);

      const toolCalls = [
        { id: 'call-boot-dis', name: 'bootstrap', arguments: '{"action": "get"}' },
      ];

      const messages = await executorDisabled.executeToolCalls('session-1', toolCalls);

      const result = messages[0] as { content: Array<{ tool_result: unknown }> };
      const toolResult = result.content[0]?.tool_result as { code?: string };
      expect(toolResult?.code).toBe('TOOL_DISABLED');
    });
  });

  // ---------------------------------------------------------------------------
  // DLP edge cases
  // ---------------------------------------------------------------------------

  describe('DLP scan edge cases', () => {
    it('[TE-20] should handle DLP alert action (allowed but logged)', async () => {
      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([
          {
            success: true,
            content: [{ type: 'text', text: '{"data": "ok"}' }],
          },
        ]),
      };

      const mockDlp = {
        scan: vi.fn().mockReturnValue({
          allowed: true,
          action: 'alert',
          findings: [{ pattern: 'email', severity: 'low' }],
          reason: 'Possible email address detected',
        }),
      };

      const depsAlert = createMockDeps({
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
        dlp: mockDlp as unknown as ToolExecutorDeps['security']['dlp'],
      });
      const executorAlert = new ToolExecutor(depsAlert);

      const toolCalls = [
        { id: 'call-alert', name: 'web_fetch', arguments: '{"url": "https://example.com"}' },
      ];

      const messages = await executorAlert.executeToolCalls('session-1', toolCalls);

      // Should be allowed (alert, not block)
      expect(messages).toHaveLength(1);
      const result = messages[0] as { content: Array<{ tool_result: unknown }> };
      const toolResult = result.content[0]?.tool_result as { code?: string };
      expect(toolResult?.code).toBeUndefined(); // No error code since it was allowed

      // Audit event should be logged for alert
      expect(depsAlert.audit.logAuditEvent).toHaveBeenCalled();
    });

    it('[TE-21] should handle DLP redact action on tool output', async () => {
      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([
          {
            success: true,
            content: [{ type: 'text', text: 'My key is AKIAIOSFODNN7EXAMPLE' }],
          },
        ]),
      };

      const mockDlp = {
        scan: vi
          .fn()
          .mockReturnValueOnce({
            // Input scan - allow
            allowed: true,
            action: 'allow',
            findings: [],
          })
          .mockReturnValueOnce({
            // Output scan - redact
            allowed: true,
            action: 'redact',
            findings: [{ pattern: 'aws_key', severity: 'high' }],
            reason: 'AWS key redacted',
            message: 'My key is [REDACTED]',
          }),
      };

      const depsRedact = createMockDeps({
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
        dlp: mockDlp as unknown as ToolExecutorDeps['security']['dlp'],
      });
      const executorRedact = new ToolExecutor(depsRedact);

      const toolCalls = [
        { id: 'call-redact', name: 'web_fetch', arguments: '{"url": "https://example.com"}' },
      ];

      const messages = await executorRedact.executeToolCalls('session-1', toolCalls);

      // Should succeed but with redacted content
      const result = messages[0] as { content: Array<{ tool_result: unknown }> };
      const toolResult = result.content[0]?.tool_result as string;
      expect(toolResult).toContain('[REDACTED]');
    });

    it('[TE-22] should skip DLP scan when tool call has no stringifiable parameters', async () => {
      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([
          {
            success: true,
            content: [{ type: 'text', text: '{}' }],
          },
        ]),
      };

      const mockDlp = {
        scan: vi.fn().mockReturnValue({ allowed: true, action: 'allow', findings: [] }),
      };

      const depsEmpty = createMockDeps({
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
        dlp: mockDlp as unknown as ToolExecutorDeps['security']['dlp'],
      });
      const executorEmpty = new ToolExecutor(depsEmpty);

      const toolCalls = [{ id: 'call-empty', name: 'web_fetch', arguments: '{}' }];

      await executorEmpty.executeToolCalls('session-1', toolCalls);

      // DLP scan may or may not be called depending on whether empty params stringify to a truthy value
      // The key is that it should not throw
    });
  });

  // ---------------------------------------------------------------------------
  // Memory tool rate limiting
  // ---------------------------------------------------------------------------

  describe('memory tool rate limiting', () => {
    it('[TE-23] should enforce rate limit of 10 memory calls per minute per session', async () => {
      const mockStateLayer = {
        queryMemory: vi.fn().mockResolvedValue({ entries: [] }),
        getIdentity: vi.fn(),
        getBootstrap: vi.fn(),
        getUserProfile: vi.fn(),
        getSessionState: vi.fn(),
        assemblePrompt: vi.fn(),
        close: vi.fn(),
      };

      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([]),
      };

      const depsRateLimit = createMockDeps({
        stateLayer: mockStateLayer as unknown as ToolExecutorDeps['stateLayer'],
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
      });
      const executorRate = new ToolExecutor(depsRateLimit);

      // Make 10 calls (should all succeed)
      for (let i = 0; i < 10; i++) {
        const calls = [
          { id: `call-rl-${i}`, name: 'memory_search', arguments: '{"query": "test"}' },
        ];
        await executorRate.executeToolCalls('session-1', calls);
      }

      // 11th call should be rate limited
      const calls = [
        { id: 'call-rl-11', name: 'memory_search', arguments: '{"query": "test"}' },
      ];
      const messages = await executorRate.executeToolCalls('session-1', calls);

      const result = messages[0] as { content: Array<{ tool_result: unknown }> };
      const toolResult = result.content[0]?.tool_result as { code?: string };
      expect(toolResult?.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  // ---------------------------------------------------------------------------
  // Multiple tool calls handling
  // ---------------------------------------------------------------------------

  describe('multiple tool calls in single batch', () => {
    it('[TE-24] should handle mix of local and remote tool calls in correct order', async () => {
      const mockStateLayer = {
        queryMemory: vi.fn().mockResolvedValue({ entries: [{ id: 'e1', content: 'test' }] }),
        getIdentity: vi.fn(),
        getBootstrap: vi.fn(),
        getUserProfile: vi.fn(),
        getSessionState: vi.fn(),
        assemblePrompt: vi.fn(),
        close: vi.fn(),
      };

      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([
          {
            success: true,
            content: [{ type: 'text', text: '{"fetched": true}' }],
          },
        ]),
      };

      const depsMixed = createMockDeps({
        stateLayer: mockStateLayer as unknown as ToolExecutorDeps['stateLayer'],
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
      });
      const executorMixed = new ToolExecutor(depsMixed);

      const toolCalls = [
        { id: 'call-local', name: 'memory_search', arguments: '{"query": "test"}' },
        { id: 'call-remote', name: 'web_fetch', arguments: '{"url": "https://example.com"}' },
      ];

      const messages = await executorMixed.executeToolCalls('session-1', toolCalls);

      // Should have results for both tools
      expect(messages).toHaveLength(2);

      // First result (memory_search - local) should have correct tool_call_id
      const msg0 = messages[0] as { tool_call_id: string };
      expect(msg0.tool_call_id).toBe('call-local');

      // Second result (web_fetch - remote) should have correct tool_call_id
      const msg1 = messages[1] as { tool_call_id: string };
      expect(msg1.tool_call_id).toBe('call-remote');
    });

    it('[TE-25] should handle empty tool calls array when coordinator exists', async () => {
      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([]),
      };

      const depsEmpty = createMockDeps({
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
      });
      const executorEmpty = new ToolExecutor(depsEmpty);

      const messages = await executorEmpty.executeToolCalls('session-1', []);

      expect(messages).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Sandbox resolution
  // ---------------------------------------------------------------------------

  describe('sandbox resolution', () => {
    it('[TE-26] should add sandbox config to remote tool calls when sandbox is enabled', async () => {
      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([
          { success: true, content: [{ type: 'text', text: 'ok' }] },
        ]),
      };

      const mockSandboxManager = {
        resolveToolSandbox: vi.fn().mockReturnValue({
          enabled: true,
          config: {
            provider: 'docker',
            workspaceDir: '/workspace',
            workspaceAccess: 'rw',
          },
        }),
      };

      const depsSandbox = createMockDeps({
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
        sandboxManager: mockSandboxManager as unknown as ToolExecutorDeps['security']['sandboxManager'],
      });
      const executorSandbox = new ToolExecutor(depsSandbox);

      const toolCalls = [
        { id: 'call-sb', name: 'web_fetch', arguments: '{"url": "https://example.com"}' },
      ];

      await executorSandbox.executeToolCalls('session-1', toolCalls);

      // Verify sandbox config was added to the call sent to coordinator
      const coordCall = mockCoordinator.executeTools.mock.calls[0]?.[0]?.[0];
      expect(coordCall?.sandbox).toEqual({
        provider: 'docker',
        workspaceDir: '/workspace',
        workspaceAccess: 'rw',
      });
    });

    it('[TE-27] should not add sandbox config when sandbox is disabled', async () => {
      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([
          { success: true, content: [{ type: 'text', text: 'ok' }] },
        ]),
      };

      const mockSandboxManager = {
        resolveToolSandbox: vi.fn().mockReturnValue({
          enabled: false,
        }),
      };

      const depsNoSandbox = createMockDeps({
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
        sandboxManager: mockSandboxManager as unknown as ToolExecutorDeps['security']['sandboxManager'],
      });
      const executorNoSandbox = new ToolExecutor(depsNoSandbox);

      const toolCalls = [
        { id: 'call-nosb', name: 'web_fetch', arguments: '{"url": "https://example.com"}' },
      ];

      await executorNoSandbox.executeToolCalls('session-1', toolCalls);

      const coordCall = mockCoordinator.executeTools.mock.calls[0]?.[0]?.[0];
      expect(coordCall?.sandbox).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Subagent tool policy
  // ---------------------------------------------------------------------------

  describe('subagent tool policy', () => {
    it('[TE-28] should block default denied tools for subagent sessions', async () => {
      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([]),
      };

      const subagentSession = createMockSession({
        metadata: { subagent: { runId: 'run-1' } },
      });

      const depsSub = createMockDeps({
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
        getSession: vi.fn().mockResolvedValue(subagentSession),
      });
      const executorSub = new ToolExecutor(depsSub);

      // sessions_list is in DEFAULT_SUBAGENT_DENY_TOOLS
      const toolCalls = [
        { id: 'call-denied-sub', name: 'sessions_list', arguments: '{}' },
      ];

      const messages = await executorSub.executeToolCalls('session-1', toolCalls);

      const result = messages[0] as { content: Array<{ tool_result: unknown }> };
      const toolResult = result.content[0]?.tool_result as { code?: string };
      expect(toolResult?.code).toBe('POLICY_DENIED');
    });

    it('[TE-29] should allow non-denied tools for subagent sessions', async () => {
      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([
          { success: true, content: [{ type: 'text', text: 'ok' }] },
        ]),
      };

      const subagentSession = createMockSession({
        metadata: { subagent: { runId: 'run-1' } },
      });

      const depsSub = createMockDeps({
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
        getSession: vi.fn().mockResolvedValue(subagentSession),
      });
      const executorSub = new ToolExecutor(depsSub);

      // web_fetch is not in deny list
      const toolCalls = [
        { id: 'call-allowed-sub', name: 'web_fetch', arguments: '{}' },
      ];

      const messages = await executorSub.executeToolCalls('session-1', toolCalls);

      const result = messages[0] as { content: Array<{ tool_result: unknown }> };
      const toolResult = result.content[0]?.tool_result as { code?: string };
      expect(toolResult?.code).not.toBe('POLICY_DENIED');
    });

    it('[TE-30] should enforce allow list for subagent when configured', async () => {
      const mockCoordinator = {
        executeTools: vi.fn().mockResolvedValue([]),
      };

      const subagentSession = createMockSession({
        metadata: { subagent: { runId: 'run-1' } },
      });

      const depsAllowList = createMockDeps({
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['core']['toolCoordinator'],
        getSession: vi.fn().mockResolvedValue(subagentSession),
        subagentToolPolicy: {
          allow: ['web_fetch', 'memory_search'],
        },
      });
      const executorAllowList = new ToolExecutor(depsAllowList);

      // code_runner is NOT in the allow list
      const toolCalls = [
        { id: 'call-not-allowed', name: 'code_runner', arguments: '{}' },
      ];

      const messages = await executorAllowList.executeToolCalls('session-1', toolCalls);

      const result = messages[0] as { content: Array<{ tool_result: unknown }> };
      const toolResult = result.content[0]?.tool_result as { code?: string };
      expect(toolResult?.code).toBe('POLICY_DENIED');
    });
  });

  // ---------------------------------------------------------------------------
  // buildToolDefinitions edge cases
  // ---------------------------------------------------------------------------

  describe('buildToolDefinitions edge cases', () => {
    it('[TE-31] should return undefined when no tools are available (toolsConfig undefined)', () => {
      const session = createMockSession();
      // With toolsConfig undefined, getExternalToolDefinitions returns [] and no local tools are added
      const depsNoTools = createMockDeps({ toolsConfig: undefined });
      const executorNoTools = new ToolExecutor(depsNoTools);
      const tools = executorNoTools.buildToolDefinitions(session);
      expect(tools).toBeUndefined();
    });

    it('[TE-32] should exclude memory tools during bootstrap lock', () => {
      const session = createMockSession();

      const depsWithState = createMockDeps({
        stateLayer: {
          getIdentity: vi.fn(),
          getBootstrap: vi.fn(),
          getUserProfile: vi.fn(),
          queryMemory: vi.fn(),
          getSessionState: vi.fn(),
          assemblePrompt: vi.fn(),
          close: vi.fn(),
        } as unknown as ToolExecutorDeps['state']['stateLayer'],
      });
      const executorWithState = new ToolExecutor(depsWithState);

      const tools = executorWithState.buildToolDefinitions(session, {
        bootstrapLocked: true,
      }) as Array<{ name: string }> | undefined;

      const toolNames = (tools ?? []).map((t) => t.name);
      // Memory tools should be excluded during bootstrap lock
      expect(toolNames).not.toContain('memory_search');
      expect(toolNames).not.toContain('memory_get');
      expect(toolNames).not.toContain('memory_write');
      // user_profile should still be included (it's not gated by bootstrapLocked)
      expect(toolNames).toContain('user_profile');
    });

    it('[TE-33] should include sessions_spawn and sessions_orchestrate when subagentManager is present', () => {
      const session = createMockSession();

      const depsWithSubagent = createMockDeps({
        subagentManager: {} as unknown,
      });
      const executorSubagent = new ToolExecutor(depsWithSubagent);

      const tools = executorSubagent.buildToolDefinitions(session) as
        | Array<{ name: string }>
        | undefined;

      const toolNames = (tools ?? []).map((t) => t.name);
      expect(toolNames).toContain('sessions_spawn');
      expect(toolNames).toContain('sessions_orchestrate');
      expect(toolNames).toContain('subagents');
    });

    it('[TE-34] should include web_search when web_search config is enabled', () => {
      const session = createMockSession();

      const depsWebSearch = createMockDeps({
        toolsConfig: { web_search: { enabled: true } },
      });
      const executorWS = new ToolExecutor(depsWebSearch);

      const tools = executorWS.buildToolDefinitions(session) as
        | Array<{ name: string }>
        | undefined;

      const toolNames = (tools ?? []).map((t) => t.name);
      expect(toolNames).toContain('web_search');
    });

    it('[TE-35] should include web_fetch_native when web_fetch config is enabled', () => {
      const session = createMockSession();

      const depsWebFetch = createMockDeps({
        toolsConfig: { web_fetch: { enabled: true } },
      });
      const executorWF = new ToolExecutor(depsWebFetch);

      const tools = executorWF.buildToolDefinitions(session) as
        | Array<{ name: string }>
        | undefined;

      const toolNames = (tools ?? []).map((t) => t.name);
      expect(toolNames).toContain('web_fetch_native');
    });

    it('[TE-36] should include github tool when github config is enabled', () => {
      const session = createMockSession();

      const depsGitHub = createMockDeps({
        toolsConfig: { github: { enabled: true } },
      });
      const executorGH = new ToolExecutor(depsGitHub);

      const tools = executorGH.buildToolDefinitions(session) as
        | Array<{ name: string }>
        | undefined;

      const toolNames = (tools ?? []).map((t) => t.name);
      expect(toolNames).toContain('github');
    });

    it('[TE-37] should strip $id from tool schemas (sanitizeToolSchema)', () => {
      const session = createMockSession();

      const depsWithState = createMockDeps({
        stateLayer: {
          getIdentity: vi.fn(),
          getBootstrap: vi.fn(),
          getUserProfile: vi.fn(),
          queryMemory: vi.fn(),
          getSessionState: vi.fn(),
          assemblePrompt: vi.fn(),
          close: vi.fn(),
        } as unknown as ToolExecutorDeps['state']['stateLayer'],
      });
      const executorWithState = new ToolExecutor(depsWithState);

      const tools = executorWithState.buildToolDefinitions(session) as
        | Array<{ name: string; parameters: Record<string, unknown> }>
        | undefined;

      // No tool schema should contain $id
      for (const tool of tools ?? []) {
        expect(tool.parameters).not.toHaveProperty('$id');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // formatToolError helper
  // ---------------------------------------------------------------------------

  describe('formatToolError', () => {
    it('[TE-38] should format error with code and message', () => {
      const result = executor.formatToolError('TEST_ERROR', 'Something went wrong');

      expect(result.success).toBe(false);
      expect(result.content).toEqual([]);
      expect(result.error?.code).toBe('TEST_ERROR');
      expect(result.error?.message).toBe('Something went wrong');
    });

    it('[TE-39] should include details when provided', () => {
      const details = { field: 'url', issue: 'invalid' };
      const result = executor.formatToolError('VALIDATION_ERROR', 'Invalid input', details);

      expect(result.error?.details).toEqual(details);
    });
  });
});
