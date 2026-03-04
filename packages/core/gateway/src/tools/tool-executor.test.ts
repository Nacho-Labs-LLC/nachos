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
 * Creates a minimal mock ToolExecutorDeps with sensible defaults.
 */
function createMockDeps(overrides: Partial<ToolExecutorDeps> = {}): ToolExecutorDeps {
  return {
    instanceId: 'test-instance',
    securityMode: 'standard',
    toolsConfig: {},
    toolCoordinator: null,
    stateLayer: undefined,
    dlp: null,
    sandboxManager: undefined,
    subagentManager: undefined,
    subagentOrchestrator: undefined,
    subagentToolPolicy: undefined,
    scheduler: undefined,
    resolveToolGroup: vi.fn().mockReturnValue(undefined),
    evaluatePolicy: vi.fn().mockReturnValue({ allowed: true }),
    logAuditEvent: vi.fn().mockResolvedValue(undefined),
    publishStatusEvent: vi.fn().mockResolvedValue(undefined),
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
    ...overrides,
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
        } as unknown as ToolExecutorDeps['stateLayer'],
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
        } as unknown as ToolExecutorDeps['stateLayer'],
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
        } as unknown as ToolExecutorDeps['stateLayer'],
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
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['toolCoordinator'],
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
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['toolCoordinator'],
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
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['toolCoordinator'],
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
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['toolCoordinator'],
        dlp: mockDlp as unknown as ToolExecutorDeps['dlp'],
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
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['toolCoordinator'],
        dlp: mockDlp as unknown as ToolExecutorDeps['dlp'],
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
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['toolCoordinator'],
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
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['toolCoordinator'],
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
        toolCoordinator: mockCoordinator as unknown as ToolExecutorDeps['toolCoordinator'],
        dlp: mockDlp as unknown as ToolExecutorDeps['dlp'],
        scheduler: mockScheduler as unknown as ToolExecutorDeps['scheduler'],
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
});
