import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseTool } from './base-tool.js';
import type { BaseToolConfig } from './base-tool.js';
import type { ToolExecutionContext } from './tool.js';
import type { ToolResult } from './types.js';
import { SecurityTier } from './types.js';

// ---------------------------------------------------------------------------
// Test double: a concrete subclass of BaseTool
// ---------------------------------------------------------------------------

class EchoTool extends BaseTool {
  initializeCalled = false;
  lastParams: Record<string, unknown> | null = null;
  lastContext: ToolExecutionContext | null = null;
  executeResult: ToolResult = {
    success: true,
    content: [{ type: 'text', text: 'echo response' }],
  };
  errors: Array<{ operation: string; error: Error; context?: Record<string, unknown> }> = [];

  /** Whether execute() should throw */
  executeShouldThrow = false;

  constructor() {
    super({
      toolId: 'echo',
      name: 'Echo Tool',
      description: 'Echoes input back',
      securityTier: SecurityTier.SAFE,
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Message to echo',
          },
          count: {
            type: 'number',
            description: 'Number of times to echo',
          },
          mode: {
            type: 'string',
            description: 'Echo mode',
            enum: ['normal', 'loud'],
          },
        },
        required: ['message'],
      },
    });
  }

  async execute(
    params: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    if (this.executeShouldThrow) {
      throw new Error('execution failed');
    }
    this.lastParams = params;
    this.lastContext = context;
    return this.executeResult;
  }

  protected override async onInitialize(_config: BaseToolConfig): Promise<void> {
    this.initializeCalled = true;
  }

  protected override onError(
    operation: string,
    error: Error,
    context?: Record<string, unknown>
  ): void {
    this.errors.push({ operation, error, context });
  }
}

// ---------------------------------------------------------------------------
// Mock bus
// ---------------------------------------------------------------------------

function createTestBus() {
  const handlers = new Map<string, Array<(data: unknown) => void | Promise<void>>>();
  const published: Array<{ topic: string; data: unknown }> = [];

  return {
    publish: vi.fn(async (topic: string, data: unknown) => {
      published.push({ topic, data });
    }),
    subscribe: vi.fn(async (topic: string, handler: (data: unknown) => void | Promise<void>) => {
      if (!handlers.has(topic)) {
        handlers.set(topic, []);
      }
      handlers.get(topic)!.push(handler);
      return { unsubscribe: vi.fn() };
    }),
    // test helpers
    _published: published,
    _handlers: handlers,
    async _dispatch(topic: string, data: unknown) {
      const topicHandlers = handlers.get(topic) ?? [];
      for (const handler of topicHandlers) {
        await handler(data);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BaseTool', () => {
  let tool: EchoTool;
  let bus: ReturnType<typeof createTestBus>;
  let config: BaseToolConfig;

  beforeEach(() => {
    tool = new EchoTool();
    bus = createTestBus();
    config = {
      config: {},
      secrets: {},
      securityMode: 'standard',
      bus,
    };
  });

  describe('constructor', () => {
    it('sets readonly metadata from options', () => {
      expect(tool.toolId).toBe('echo');
      expect(tool.name).toBe('Echo Tool');
      expect(tool.description).toBe('Echoes input back');
      expect(tool.securityTier).toBe(SecurityTier.SAFE);
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.required).toEqual(['message']);
    });
  });

  describe('initialize()', () => {
    it('calls onInitialize hook', async () => {
      await tool.initialize(config);

      expect(tool.initializeCalled).toBe(true);
    });
  });

  describe('start()', () => {
    it('subscribes to the tool request topic', async () => {
      await tool.initialize(config);
      await tool.start();

      expect(bus.subscribe).toHaveBeenCalledWith('nachos.tool.echo.request', expect.any(Function));
    });
  });

  describe('stop()', () => {
    it('calls unsubscribe on the subscription handle', async () => {
      await tool.initialize(config);
      await tool.start();

      const subscribeCall = bus.subscribe.mock.results[0];
      const subscriptionHandle = await subscribeCall?.value;
      expect(subscriptionHandle.unsubscribe).not.toHaveBeenCalled();

      await tool.stop();

      expect(subscriptionHandle.unsubscribe).toHaveBeenCalled();
    });
  });

  describe('validate()', () => {
    it('passes when all required parameters are present and valid', () => {
      const result = tool.validate({ message: 'hello' });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('fails when a required parameter is missing', () => {
      const result = tool.validate({});

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Required parameter missing: message');
    });

    it('fails when a parameter has the wrong type', () => {
      const result = tool.validate({ message: 123 });

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Parameter 'message' must be string, got number"),
        ])
      );
    });

    it('fails when an enum parameter has an invalid value', () => {
      const result = tool.validate({ message: 'hello', mode: 'whisper' });

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Parameter 'mode' must be one of: normal, loud"),
        ])
      );
    });

    it('passes with valid optional parameters', () => {
      const result = tool.validate({ message: 'hello', count: 3, mode: 'loud' });

      expect(result.valid).toBe(true);
    });

    it('reports multiple errors at once', () => {
      const result = tool.validate({ count: 'not-a-number' });

      expect(result.valid).toBe(false);
      // Should have both: missing 'message' and wrong type for 'count'
      expect(result.errors?.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('request handling (via bus dispatch)', () => {
    it('calls execute with params and context, publishes response', async () => {
      await tool.initialize(config);
      await tool.start();

      await bus._dispatch('nachos.tool.echo.request', {
        callId: 'call-1',
        sessionId: 'session-1',
        params: { message: 'hello world' },
      });

      // execute was called
      expect(tool.lastParams).toEqual({ message: 'hello world' });
      expect(tool.lastContext).toEqual({
        callId: 'call-1',
        sessionId: 'session-1',
      });

      // Response was published to the response topic
      expect(bus.publish).toHaveBeenCalledWith(
        'nachos.tool.echo.response',
        expect.objectContaining({
          callId: 'call-1',
          sessionId: 'session-1',
          toolId: 'echo',
          result: expect.objectContaining({
            success: true,
            content: [{ type: 'text', text: 'echo response' }],
          }),
        })
      );
    });

    it('adds duration metadata to the result', async () => {
      await tool.initialize(config);
      await tool.start();

      await bus._dispatch('nachos.tool.echo.request', {
        callId: 'call-1',
        sessionId: 'session-1',
        params: { message: 'hello' },
      });

      const publishCall = bus.publish.mock.calls[0];
      const responsePayload = publishCall?.[1] as { result: ToolResult };
      expect(responsePayload.result.metadata?.duration).toBeGreaterThanOrEqual(0);
    });

    it('returns a validation error for invalid params', async () => {
      await tool.initialize(config);
      await tool.start();

      await bus._dispatch('nachos.tool.echo.request', {
        callId: 'call-2',
        sessionId: 'session-1',
        params: {}, // missing required 'message'
      });

      // execute should NOT have been called
      expect(tool.lastParams).toBeNull();

      // Error response was published
      expect(bus.publish).toHaveBeenCalledWith(
        'nachos.tool.echo.response',
        expect.objectContaining({
          callId: 'call-2',
          result: expect.objectContaining({
            success: false,
            error: expect.objectContaining({
              code: 'VALIDATION_ERROR',
            }),
          }),
        })
      );
    });

    it('catches execute errors and publishes an error response', async () => {
      tool.executeShouldThrow = true;

      await tool.initialize(config);
      await tool.start();

      await bus._dispatch('nachos.tool.echo.request', {
        callId: 'call-3',
        sessionId: 'session-1',
        params: { message: 'hello' },
      });

      // Error response was published
      expect(bus.publish).toHaveBeenCalledWith(
        'nachos.tool.echo.response',
        expect.objectContaining({
          callId: 'call-3',
          result: expect.objectContaining({
            success: false,
            error: expect.objectContaining({
              code: 'EXECUTION_ERROR',
              message: 'execution failed',
            }),
          }),
        })
      );

      // onError was called
      expect(tool.errors).toHaveLength(1);
      expect(tool.errors[0]?.operation).toBe('execute');
    });

    it('handles missing callId and sessionId gracefully', async () => {
      await tool.initialize(config);
      await tool.start();

      await bus._dispatch('nachos.tool.echo.request', {
        params: { message: 'hello' },
      });

      // execute was still called
      expect(tool.lastParams).toEqual({ message: 'hello' });
      expect(tool.lastContext?.sessionId).toBe('unknown');
      expect(tool.lastContext?.callId).toMatch(/^echo-/);
    });

    it('handles missing params gracefully (treated as empty object)', async () => {
      await tool.initialize(config);
      await tool.start();

      await bus._dispatch('nachos.tool.echo.request', {
        callId: 'call-4',
        sessionId: 'session-1',
        // no params field
      });

      // Should fail validation (missing required 'message')
      expect(bus.publish).toHaveBeenCalledWith(
        'nachos.tool.echo.response',
        expect.objectContaining({
          result: expect.objectContaining({
            success: false,
            error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
          }),
        })
      );
    });
  });

  describe('healthCheck()', () => {
    it('returns healthy when the tool is running', async () => {
      await tool.initialize(config);
      await tool.start();

      const health = await tool.healthCheck();

      expect(health.healthy).toBe(true);
    });

    it('returns unhealthy when the tool is not running', async () => {
      await tool.initialize(config);

      const health = await tool.healthCheck();

      expect(health.healthy).toBe(false);
    });
  });

  describe('validate() with additionalProperties: false', () => {
    it('rejects unknown parameters', () => {
      const strictTool = new (class extends BaseTool {
        constructor() {
          super({
            toolId: 'strict',
            name: 'Strict Tool',
            description: 'Strict params',
            securityTier: SecurityTier.SAFE,
            parameters: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Name' },
              },
              required: ['name'],
              additionalProperties: false,
            },
          });
        }
        async execute(): Promise<ToolResult> {
          return { success: true, content: [] };
        }
      })();

      const result = strictTool.validate({ name: 'ok', extra: 'bad' });

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('Unknown parameter: extra')])
      );
    });
  });
});
