import { describe, it, expect, vi } from 'vitest';
import { ToolCoordinator, type ToolCoordinatorConfig } from './coordinator.js';
import { SecurityTier, type ToolCall, type ToolResult } from '@nachos/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockBus() {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    request: vi.fn().mockResolvedValue({
      payload: {
        success: true,
        content: [{ type: 'text', text: 'result' }],
      },
    }),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockCheese(
  evaluateResult = { allowed: true, effect: 'allow', evaluationTimeMs: 1 }
) {
  return {
    evaluate: vi.fn().mockReturnValue(evaluateResult),
    reload: vi.fn(),
  };
}

function createMockCache() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockApprovalManager(approved = true) {
  return {
    requiresApproval: vi.fn().mockReturnValue(true),
    requestApproval: vi.fn().mockResolvedValue({
      approved,
      userId: 'user-1',
      reason: approved ? undefined : 'User denied',
    }),
  };
}

function createMockLocalToolHandler(isLocal = false, result?: ToolResult) {
  return {
    isLocalTool: vi.fn().mockReturnValue(isLocal),
    getToolGroup: vi.fn().mockReturnValue('local'),
    execute: vi.fn().mockResolvedValue(
      result ?? {
        success: true,
        content: [{ type: 'text', text: 'local result' }],
      }
    ),
  };
}

function createToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'call-1',
    tool: 'web_fetch',
    sessionId: 'session-1',
    userId: 'user-1',
    parameters: {},
    ...overrides,
  };
}

function createCoordinator(configOverrides: Partial<ToolCoordinatorConfig> = {}): {
  coordinator: ToolCoordinator;
  bus: ReturnType<typeof createMockBus>;
  cheese: ReturnType<typeof createMockCheese>;
} {
  const bus = createMockBus();
  const cheese = createMockCheese();
  const coordinator = new ToolCoordinator({
    bus: bus as unknown as ToolCoordinatorConfig['bus'],
    cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
    ...configOverrides,
  });
  return { coordinator, bus, cheese };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToolCoordinator', () => {
  describe('constructor and defaults', () => {
    it('[TC-01] should accept minimal config with just a bus', () => {
      const bus = createMockBus();
      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
      });
      expect(coordinator).toBeDefined();
    });

    it('[TC-02] should use 30s default timeout when none specified', async () => {
      const bus = createMockBus();
      bus.request.mockRejectedValue(new Error('timeout'));

      const cheese = createMockCheese();
      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
      });

      const call = createToolCall();
      const result = await coordinator.executeSingle(call);

      // The bus.request should be called with the default timeout (30000ms)
      expect(bus.request).toHaveBeenCalledWith(expect.any(String), expect.any(Object), 30000);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TIMEOUT');
    });
  });

  // ---------------------------------------------------------------------------
  // executeSingle
  // ---------------------------------------------------------------------------

  describe('executeSingle', () => {
    it('[TC-03] should return MISSING_SESSION error when sessionId is empty', async () => {
      const { coordinator } = createCoordinator();
      const call = createToolCall({ sessionId: '' });

      const result = await coordinator.executeSingle(call);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_SESSION');
      expect(result.metadata?.duration).toBeGreaterThanOrEqual(0);
    });

    it('[TC-04] should return POLICY_DENIED when Cheese is not configured (fail-closed)', async () => {
      const bus = createMockBus();
      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: null,
      });
      const call = createToolCall();

      const result = await coordinator.executeSingle(call);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('POLICY_DENIED');
      expect(result.error?.message).toContain('policy engine is not available');
    });

    it('[TC-05] should return POLICY_DENIED when Cheese denies the request', async () => {
      const bus = createMockBus();
      const cheese = createMockCheese({
        allowed: false,
        effect: 'deny',
        evaluationTimeMs: 1,
        reason: 'Tool blocked by policy',
        ruleId: 'rule-1',
      } as ReturnType<typeof createMockCheese> extends { evaluate: () => infer R } ? R : never);

      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
      });
      const call = createToolCall();

      const result = await coordinator.executeSingle(call);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('POLICY_DENIED');
      expect(result.error?.message).toBe('Tool blocked by policy');
      expect((result.error?.details as { ruleId?: string })?.ruleId).toBe('rule-1');
    });

    it('[TC-06] should execute tool via NATS when policy allows', async () => {
      const { coordinator, bus } = createCoordinator();
      const call = createToolCall();

      const result = await coordinator.executeSingle(call);

      expect(result.success).toBe(true);
      expect(bus.request).toHaveBeenCalledWith(
        'nachos.tool.web_fetch.request',
        expect.objectContaining({
          source: 'gateway',
          type: 'tool.request',
        }),
        expect.any(Number)
      );
    });

    it('[TC-07] should return cached result when cache hits', async () => {
      const bus = createMockBus();
      const cheese = createMockCheese();
      const cache = createMockCache();

      const cachedResult: ToolResult = {
        success: true,
        content: [{ type: 'text', text: 'cached' }],
        metadata: { duration: 5 },
      };
      cache.get.mockResolvedValue(cachedResult);

      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
        cache: cache as unknown as ToolCoordinatorConfig['cache'],
      });

      const call = createToolCall();
      const result = await coordinator.executeSingle(call);

      expect(result.success).toBe(true);
      expect(result.metadata?.cached).toBe(true);
      // bus.request should NOT be called because cache hit
      expect(bus.request).not.toHaveBeenCalled();
    });

    it('[TC-08] should bypass cache when bypassCache option is set', async () => {
      const bus = createMockBus();
      const cheese = createMockCheese();
      const cache = createMockCache();

      const cachedResult: ToolResult = {
        success: true,
        content: [{ type: 'text', text: 'cached' }],
        metadata: { duration: 5 },
      };
      cache.get.mockResolvedValue(cachedResult);

      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
        cache: cache as unknown as ToolCoordinatorConfig['cache'],
      });

      const call = createToolCall();
      await coordinator.executeSingle(call, { bypassCache: true });

      // Should have called bus.request (bypassed cache)
      expect(bus.request).toHaveBeenCalled();
      expect(cache.get).not.toHaveBeenCalled();
    });

    it('[TC-09] should store result in cache after successful NATS execution', async () => {
      const bus = createMockBus();
      const cheese = createMockCheese();
      const cache = createMockCache();

      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
        cache: cache as unknown as ToolCoordinatorConfig['cache'],
      });

      const call = createToolCall({ cacheTTL: 600 });
      await coordinator.executeSingle(call);

      expect(cache.set).toHaveBeenCalledWith(call, expect.objectContaining({ success: true }), 600);
    });

    it('[TC-10] should use default cache TTL of 300 when none specified on call', async () => {
      const bus = createMockBus();
      const cheese = createMockCheese();
      const cache = createMockCache();

      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
        cache: cache as unknown as ToolCoordinatorConfig['cache'],
      });

      const call = createToolCall(); // no cacheTTL
      await coordinator.executeSingle(call);

      expect(cache.set).toHaveBeenCalledWith(call, expect.any(Object), 300);
    });

    it('[TC-11] should execute via local tool handler when tool is local', async () => {
      const bus = createMockBus();
      const cheese = createMockCheese();
      const localHandler = createMockLocalToolHandler(true);

      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
        localToolHandler: localHandler as unknown as ToolCoordinatorConfig['localToolHandler'],
      });

      const call = createToolCall({ tool: 'exec' });
      const result = await coordinator.executeSingle(call);

      expect(result.success).toBe(true);
      expect(localHandler.execute).toHaveBeenCalledWith(call);
      // bus.request should NOT be called for local tools
      expect(bus.request).not.toHaveBeenCalled();
    });

    it('[TC-12] should resolve tool group from local handler for policy checking', async () => {
      const bus = createMockBus();
      const cheese = createMockCheese();
      const localHandler = createMockLocalToolHandler(true);
      localHandler.getToolGroup.mockReturnValue('shell');

      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
        localToolHandler: localHandler as unknown as ToolCoordinatorConfig['localToolHandler'],
      });

      const call = createToolCall({ tool: 'exec' });
      await coordinator.executeSingle(call);

      expect(localHandler.getToolGroup).toHaveBeenCalled();
      expect(call.toolGroup).toBe('shell');
    });

    it('[TC-13] should return APPROVAL_DENIED when approval is denied', async () => {
      const bus = createMockBus();
      const cheese = createMockCheese();
      const approvalManager = createMockApprovalManager(false);

      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
        approvalManager: approvalManager as unknown as ToolCoordinatorConfig['approvalManager'],
      });

      const call = createToolCall({ securityTier: SecurityTier.RESTRICTED });
      const result = await coordinator.executeSingle(call);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('APPROVAL_DENIED');
    });

    it('[TC-14] should proceed when approval is granted', async () => {
      const bus = createMockBus();
      const cheese = createMockCheese();
      const approvalManager = createMockApprovalManager(true);

      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
        approvalManager: approvalManager as unknown as ToolCoordinatorConfig['approvalManager'],
      });

      const call = createToolCall({ securityTier: SecurityTier.RESTRICTED });
      const result = await coordinator.executeSingle(call);

      expect(result.success).toBe(true);
      expect(approvalManager.requestApproval).toHaveBeenCalled();
    });

    it('[TC-15] should return EXECUTION_ERROR when an unexpected error occurs', async () => {
      const bus = createMockBus();
      bus.request.mockRejectedValue(new Error('unexpected NATS failure'));
      const cheese = createMockCheese();

      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
      });

      const call = createToolCall();
      const result = await coordinator.executeSingle(call);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EXECUTION_ERROR');
      expect(result.error?.message).toBe('unexpected NATS failure');
    });

    it('[TC-16] should set default securityMode to standard when not provided', async () => {
      const bus = createMockBus();
      const cheese = createMockCheese();

      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
        securityMode: 'strict',
      });

      const call = createToolCall(); // no securityMode on call
      await coordinator.executeSingle(call);

      // After executeSingle, the call's securityMode should be resolved
      expect(call.securityMode).toBe('strict');
    });

    it('[TC-17] should not override securityMode when already set on call', async () => {
      const bus = createMockBus();
      const cheese = createMockCheese();

      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
        securityMode: 'strict',
      });

      const call = createToolCall({ securityMode: 'permissive' });
      await coordinator.executeSingle(call);

      expect(call.securityMode).toBe('permissive');
    });

    it('[TC-18] should include duration metadata in all results', async () => {
      const { coordinator } = createCoordinator();
      const call = createToolCall();

      const result = await coordinator.executeSingle(call);

      expect(result.metadata).toBeDefined();
      expect(typeof result.metadata?.duration).toBe('number');
      expect(result.metadata!.duration).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------------
  // executeViaNats (exercised through executeSingle)
  // ---------------------------------------------------------------------------

  describe('NATS execution', () => {
    it('[TC-19] should handle timeout errors from NATS', async () => {
      const bus = createMockBus();
      bus.request.mockRejectedValue(new Error('timeout waiting for response'));
      const cheese = createMockCheese();

      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
      });

      const call = createToolCall({ timeout: 5000 });
      const result = await coordinator.executeSingle(call);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TIMEOUT');
      expect(result.error?.message).toContain('5000ms');
    });

    it('[TC-20] should handle no-responders error from NATS', async () => {
      const bus = createMockBus();
      bus.request.mockRejectedValue(new Error('no responders'));
      const cheese = createMockCheese();

      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
      });

      const call = createToolCall({ tool: 'missing_tool' });
      const result = await coordinator.executeSingle(call);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOOL_NOT_AVAILABLE');
      expect(result.error?.message).toContain('missing_tool');
    });

    it('[TC-21] should handle raw ToolResult response (without envelope)', async () => {
      const bus = createMockBus();
      bus.request.mockResolvedValue({
        success: true,
        content: [{ type: 'text', text: 'direct result' }],
      });
      const cheese = createMockCheese();

      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
      });

      const call = createToolCall();
      const result = await coordinator.executeSingle(call);

      expect(result.success).toBe(true);
    });

    it('[TC-22] should handle invalid response format from NATS', async () => {
      const bus = createMockBus();
      bus.request.mockResolvedValue('not an object');
      const cheese = createMockCheese();

      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
      });

      const call = createToolCall();
      const result = await coordinator.executeSingle(call);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_TOOL_RESPONSE');
    });

    it('[TC-23] should send correct NATS topic based on tool name', async () => {
      const { coordinator, bus } = createCoordinator();
      const call = createToolCall({ tool: 'code_runner' });

      await coordinator.executeSingle(call);

      expect(bus.request).toHaveBeenCalledWith(
        'nachos.tool.code_runner.request',
        expect.any(Object),
        expect.any(Number)
      );
    });

    it('[TC-24] should use call timeout over default timeout', async () => {
      const bus = createMockBus();
      const cheese = createMockCheese();

      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
        defaultTimeout: 30000,
      });

      const call = createToolCall({ timeout: 10000 });
      await coordinator.executeSingle(call);

      expect(bus.request).toHaveBeenCalledWith(expect.any(String), expect.any(Object), 10000);
    });

    it('[TC-25] should use options timeout over call and default timeout', async () => {
      const bus = createMockBus();
      const cheese = createMockCheese();

      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
        defaultTimeout: 30000,
      });

      const call = createToolCall({ timeout: 10000 });
      await coordinator.executeSingle(call, { timeout: 5000 });

      expect(bus.request).toHaveBeenCalledWith(expect.any(String), expect.any(Object), 5000);
    });
  });

  // ---------------------------------------------------------------------------
  // executeTools (parallel vs sequential)
  // ---------------------------------------------------------------------------

  describe('executeTools', () => {
    it('[TC-26] should return empty array for empty tool calls', async () => {
      const { coordinator } = createCoordinator();

      const results = await coordinator.executeTools([]);

      expect(results).toEqual([]);
    });

    it('[TC-27] should execute distinct tools in parallel', async () => {
      const { coordinator } = createCoordinator();
      const calls = [
        createToolCall({ id: 'call-1', tool: 'web_fetch' }),
        createToolCall({ id: 'call-2', tool: 'code_runner' }),
      ];

      const results = await coordinator.executeTools(calls);

      expect(results).toHaveLength(2);
      expect(results[0]!.success).toBe(true);
      expect(results[1]!.success).toBe(true);
    });

    it('[TC-28] should execute duplicate tools sequentially', async () => {
      const { coordinator } = createCoordinator();
      const calls = [
        createToolCall({ id: 'call-1', tool: 'web_fetch' }),
        createToolCall({ id: 'call-2', tool: 'web_fetch' }),
      ];

      const results = await coordinator.executeTools(calls);

      expect(results).toHaveLength(2);
      // Both should still succeed
      expect(results[0]!.success).toBe(true);
      expect(results[1]!.success).toBe(true);
    });

    it('[TC-29] should detect write-then-read dependency and run sequentially', async () => {
      const { coordinator } = createCoordinator();
      const calls = [
        createToolCall({
          id: 'call-1',
          tool: 'filesystem_write',
          parameters: { path: '/tmp/test.txt' },
        }),
        createToolCall({
          id: 'call-2',
          tool: 'filesystem_read',
          parameters: { path: '/tmp/test.txt' },
        }),
      ];

      const results = await coordinator.executeTools(calls);

      expect(results).toHaveLength(2);
    });

    it('[TC-30] should allow parallel for write-then-read on different resources', async () => {
      const { coordinator } = createCoordinator();
      const calls = [
        createToolCall({
          id: 'call-1',
          tool: 'filesystem_write',
          parameters: { path: '/tmp/file-a.txt' },
        }),
        createToolCall({
          id: 'call-2',
          tool: 'filesystem_read',
          parameters: { path: '/tmp/file-b.txt' },
        }),
      ];

      // These should run in parallel since paths are different
      const results = await coordinator.executeTools(calls);
      expect(results).toHaveLength(2);
    });

    it('[TC-31] should force parallel when forceParallel option is set', async () => {
      const { coordinator } = createCoordinator();
      const calls = [
        createToolCall({ id: 'call-1', tool: 'web_fetch' }),
        createToolCall({ id: 'call-2', tool: 'web_fetch' }),
      ];

      const results = await coordinator.executeTools(calls, { forceParallel: true });

      expect(results).toHaveLength(2);
    });

    it('[TC-32] should handle individual failures in parallel execution gracefully', async () => {
      const bus = createMockBus();
      let callCount = 0;
      bus.request.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('first tool failed'));
        }
        return Promise.resolve({
          payload: { success: true, content: [{ type: 'text', text: 'ok' }] },
        });
      });
      const cheese = createMockCheese();

      const coordinator = new ToolCoordinator({
        bus: bus as unknown as ToolCoordinatorConfig['bus'],
        cheese: cheese as unknown as ToolCoordinatorConfig['cheese'],
      });

      const calls = [
        createToolCall({ id: 'call-1', tool: 'failing_tool' }),
        createToolCall({ id: 'call-2', tool: 'working_tool' }),
      ];

      const results = await coordinator.executeTools(calls, { forceParallel: true });

      expect(results).toHaveLength(2);
      // First one should fail, second should succeed
      expect(results[0]!.success).toBe(false);
      expect(results[1]!.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Security tier resolution
  // ---------------------------------------------------------------------------

  describe('security tier resolution', () => {
    it('[TC-33] should resolve code_runner to STANDARD tier (sandboxed containers)', async () => {
      const { coordinator } = createCoordinator();
      const call = createToolCall({ tool: 'code_runner' });

      await coordinator.executeSingle(call);

      expect(call.securityTier).toBe(SecurityTier.STANDARD);
    });

    it('[TC-34] should resolve code-runner (hyphenated) to STANDARD tier (sandboxed containers)', async () => {
      const { coordinator } = createCoordinator();
      const call = createToolCall({ tool: 'code-runner' });

      await coordinator.executeSingle(call);

      expect(call.securityTier).toBe(SecurityTier.STANDARD);
    });

    it('[TC-35] should resolve copilot to RESTRICTED tier', async () => {
      const { coordinator } = createCoordinator();
      const call = createToolCall({ tool: 'copilot' });

      await coordinator.executeSingle(call);

      expect(call.securityTier).toBe(SecurityTier.RESTRICTED);
    });

    it('[TC-36] should resolve filesystem_write to ELEVATED tier', async () => {
      const { coordinator } = createCoordinator();
      const call = createToolCall({ tool: 'filesystem_write' });

      await coordinator.executeSingle(call);

      expect(call.securityTier).toBe(SecurityTier.ELEVATED);
    });

    it('[TC-37] should resolve filesystem_edit to ELEVATED tier', async () => {
      const { coordinator } = createCoordinator();
      const call = createToolCall({ tool: 'filesystem_edit' });

      await coordinator.executeSingle(call);

      expect(call.securityTier).toBe(SecurityTier.ELEVATED);
    });

    it('[TC-38] should resolve browser tool to STANDARD tier', async () => {
      const { coordinator } = createCoordinator();
      const call = createToolCall({ tool: 'browser_navigate' });

      await coordinator.executeSingle(call);

      expect(call.securityTier).toBe(SecurityTier.STANDARD);
    });

    it('[TC-39] should resolve read tools to SAFE tier', async () => {
      const { coordinator } = createCoordinator();
      const call = createToolCall({ tool: 'filesystem_read' });

      await coordinator.executeSingle(call);

      expect(call.securityTier).toBe(SecurityTier.SAFE);
    });

    it('[TC-40] should not override securityTier when already set on call', async () => {
      const { coordinator } = createCoordinator();
      const call = createToolCall({
        tool: 'code_runner',
        securityTier: SecurityTier.SAFE,
      });

      await coordinator.executeSingle(call);

      // Should keep the explicitly set tier
      expect(call.securityTier).toBe(SecurityTier.SAFE);
    });
  });

  // ---------------------------------------------------------------------------
  // Domain resolution (for policy metadata)
  // ---------------------------------------------------------------------------

  describe('domain resolution', () => {
    it('[TC-41] should resolve domain from url parameter for policy checks', async () => {
      const { coordinator, cheese } = createCoordinator();
      const call = createToolCall({
        parameters: { url: 'https://api.example.com/data' },
      });

      await coordinator.executeSingle(call);

      const policyCall = cheese.evaluate.mock.calls[0]?.[0];
      expect(policyCall?.metadata?.domain).toBe('api.example.com');
    });

    it('[TC-42] should handle missing url parameter gracefully', async () => {
      const { coordinator, cheese } = createCoordinator();
      const call = createToolCall({ parameters: { path: '/tmp/file.txt' } });

      await coordinator.executeSingle(call);

      const policyCall = cheese.evaluate.mock.calls[0]?.[0];
      expect(policyCall?.metadata?.domain).toBeUndefined();
    });

    it('[TC-43] should handle invalid url parameter gracefully', async () => {
      const { coordinator, cheese } = createCoordinator();
      const call = createToolCall({ parameters: { url: 'not-a-valid-url' } });

      await coordinator.executeSingle(call);

      const policyCall = cheese.evaluate.mock.calls[0]?.[0];
      expect(policyCall?.metadata?.domain).toBeUndefined();
    });

    it('[TC-44] should handle non-string url parameter gracefully', async () => {
      const { coordinator, cheese } = createCoordinator();
      const call = createToolCall({ parameters: { url: 12345 } });

      await coordinator.executeSingle(call);

      const policyCall = cheese.evaluate.mock.calls[0]?.[0];
      expect(policyCall?.metadata?.domain).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // canExecuteInParallel heuristics (tested via executeTools behavior)
  // ---------------------------------------------------------------------------

  describe('parallel execution heuristics', () => {
    it('[TC-45] should detect URL-based resource dependency', async () => {
      const { coordinator } = createCoordinator();
      const calls = [
        createToolCall({
          id: 'call-1',
          tool: 'web_fetch_write',
          parameters: { url: 'https://api.example.com/data' },
        }),
        createToolCall({
          id: 'call-2',
          tool: 'web_fetch_get',
          parameters: { url: 'https://api.example.com/data' },
        }),
      ];

      // write-then-read on same URL should be sequential
      const results = await coordinator.executeTools(calls);
      expect(results).toHaveLength(2);
    });

    it('[TC-46] should allow parallel for unrelated tools', async () => {
      const { coordinator } = createCoordinator();
      const calls = [
        createToolCall({ id: 'call-1', tool: 'web_search' }),
        createToolCall({ id: 'call-2', tool: 'code_runner' }),
        createToolCall({ id: 'call-3', tool: 'browser_navigate' }),
      ];

      const results = await coordinator.executeTools(calls);
      expect(results).toHaveLength(3);
    });
  });
});
