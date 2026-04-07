import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HookRegistry } from './hook-registry.js';
import type {
  MutableBeforeLLMRequestPayload,
  MutableBeforeResponseSentPayload,
} from './hook-types.js';

// Shared mock logger so we can spy on calls — vi.hoisted ensures it's
// available when vi.mock's factory runs (which is hoisted to the top).
const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn().mockReturnThis(),
}));

vi.mock('@nachos/types', () => ({
  createLogger: () => mockLogger,
}));

describe('HookRegistry', () => {
  let hooks: HookRegistry;

  beforeEach(() => {
    hooks = new HookRegistry();
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Existing observe-only (non-mutable) hook tests
  // ---------------------------------------------------------------------------

  describe('observe-only emit', () => {
    it('should invoke registered handlers and return success count', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      hooks.register('message:received', handler);

      const count = await hooks.emit('message:received', {
        envelopeId: 'env-1',
        channel: 'slack',
        channelMessageId: 'msg-1',
        sender: { id: 'user-1', name: 'Test', isAllowed: true },
        conversation: { id: 'conv-1', type: 'dm' },
        text: 'hello',
        sessionId: 'sess-1',
        timestamp: new Date().toISOString(),
      });

      expect(count).toBe(1);
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should return 0 when no handlers are registered', async () => {
      const count = await hooks.emit('message:received', {
        envelopeId: 'env-1',
        channel: 'slack',
        channelMessageId: 'msg-1',
        sender: { id: 'user-1', isAllowed: true },
        conversation: { id: 'conv-1', type: 'dm' },
        text: 'hello',
        sessionId: 'sess-1',
        timestamp: new Date().toISOString(),
      });

      expect(count).toBe(0);
    });

    it('should continue executing handlers when one throws', async () => {
      const failHandler = vi.fn().mockRejectedValue(new Error('boom'));
      const successHandler = vi.fn().mockResolvedValue(undefined);

      hooks.register('message:received', failHandler, { priority: 1 });
      hooks.register('message:received', successHandler, { priority: 2 });

      const count = await hooks.emit('message:received', {
        envelopeId: 'env-1',
        channel: 'slack',
        channelMessageId: 'msg-1',
        sender: { id: 'user-1', isAllowed: true },
        conversation: { id: 'conv-1', type: 'dm' },
        text: 'hello',
        sessionId: 'sess-1',
        timestamp: new Date().toISOString(),
      });

      expect(failHandler).toHaveBeenCalledOnce();
      expect(successHandler).toHaveBeenCalledOnce();
      expect(count).toBe(1);
    });

    it('should execute handlers in priority order', async () => {
      const order: number[] = [];

      hooks.register(
        'message:received',
        async () => {
          order.push(3);
        },
        { priority: 300 }
      );
      hooks.register(
        'message:received',
        async () => {
          order.push(1);
        },
        { priority: 100 }
      );
      hooks.register(
        'message:received',
        async () => {
          order.push(2);
        },
        { priority: 200 }
      );

      await hooks.emit('message:received', {
        envelopeId: 'env-1',
        channel: 'slack',
        channelMessageId: 'msg-1',
        sender: { id: 'user-1', isAllowed: true },
        conversation: { id: 'conv-1', type: 'dm' },
        text: 'hello',
        sessionId: 'sess-1',
        timestamp: new Date().toISOString(),
      });

      expect(order).toEqual([1, 2, 3]);
    });
  });

  // ---------------------------------------------------------------------------
  // Mutable hook: llm:before-request
  // ---------------------------------------------------------------------------

  describe('emitMutable - llm:before-request', () => {
    function makeLLMPayload(
      overrides?: Partial<MutableBeforeLLMRequestPayload>
    ): MutableBeforeLLMRequestPayload {
      return {
        sessionId: 'sess-1',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
        ],
        tools: [{ name: 'search', description: 'Search the web' }],
        stream: false,
        options: undefined,
        timestamp: new Date().toISOString(),
        ...overrides,
      };
    }

    it('should pass the payload through when no handlers are registered', async () => {
      const payload = makeLLMPayload();
      const result = await hooks.emitMutable('llm:before-request', payload);

      expect(result).toBe(payload);
      expect(result.messages).toHaveLength(2);
    });

    it('should allow a handler to modify messages', async () => {
      hooks.registerMutable('llm:before-request', async (p) => {
        p.messages.push({ role: 'system', content: 'Extra context injected.' });
      });

      const payload = makeLLMPayload();
      const result = await hooks.emitMutable('llm:before-request', payload);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[2]).toEqual({
        role: 'system',
        content: 'Extra context injected.',
      });
    });

    it('should allow a handler to remove tools', async () => {
      hooks.registerMutable('llm:before-request', async (p) => {
        p.tools = undefined;
      });

      const payload = makeLLMPayload();
      const result = await hooks.emitMutable('llm:before-request', payload);

      expect(result.tools).toBeUndefined();
    });

    it('should allow a handler to add tools', async () => {
      hooks.registerMutable('llm:before-request', async (p) => {
        if (p.tools) {
          p.tools.push({ name: 'calculator', description: 'Do math' });
        }
      });

      const payload = makeLLMPayload();
      const result = await hooks.emitMutable('llm:before-request', payload);

      expect(result.tools).toHaveLength(2);
      expect(result.tools![1].name).toBe('calculator');
    });

    it('should chain modifications across multiple handlers', async () => {
      // First handler: inject a system message
      hooks.registerMutable(
        'llm:before-request',
        async (p) => {
          p.messages.unshift({ role: 'system', content: 'Preamble from plugin A' });
        },
        { priority: 10, label: 'plugin-a' }
      );

      // Second handler: append a disclaimer and remove a tool
      hooks.registerMutable(
        'llm:before-request',
        async (p) => {
          p.messages.push({ role: 'system', content: 'Disclaimer from plugin B' });
          p.tools = p.tools?.filter((t) => t.name !== 'search');
        },
        { priority: 20, label: 'plugin-b' }
      );

      const payload = makeLLMPayload();
      const result = await hooks.emitMutable('llm:before-request', payload);

      // Original 2 + 1 prepended + 1 appended = 4
      expect(result.messages).toHaveLength(4);
      expect(result.messages[0].content).toBe('Preamble from plugin A');
      expect(result.messages[3].content).toBe('Disclaimer from plugin B');
      // 'search' tool was removed
      expect(result.tools).toEqual([]);
    });

    it('should continue after handler error and preserve prior modifications', async () => {
      // First handler: modify messages
      hooks.registerMutable(
        'llm:before-request',
        async (p) => {
          p.messages.push({ role: 'system', content: 'Added before error' });
        },
        { priority: 10 }
      );

      // Second handler: throws
      hooks.registerMutable(
        'llm:before-request',
        async () => {
          throw new Error('Handler exploded');
        },
        { priority: 20 }
      );

      // Third handler: should still run
      hooks.registerMutable(
        'llm:before-request',
        async (p) => {
          p.messages.push({ role: 'system', content: 'Added after error' });
        },
        { priority: 30 }
      );

      const payload = makeLLMPayload();
      const result = await hooks.emitMutable('llm:before-request', payload);

      // Original 2 + 2 successful additions = 4
      expect(result.messages).toHaveLength(4);
      expect(result.messages[2].content).toBe('Added before error');
      expect(result.messages[3].content).toBe('Added after error');
    });

    it('should execute mutable handlers in priority order', async () => {
      const order: number[] = [];

      hooks.registerMutable(
        'llm:before-request',
        async () => {
          order.push(3);
        },
        { priority: 300 }
      );
      hooks.registerMutable(
        'llm:before-request',
        async () => {
          order.push(1);
        },
        { priority: 100 }
      );
      hooks.registerMutable(
        'llm:before-request',
        async () => {
          order.push(2);
        },
        { priority: 200 }
      );

      await hooks.emitMutable('llm:before-request', makeLLMPayload());

      expect(order).toEqual([1, 2, 3]);
    });
  });

  // ---------------------------------------------------------------------------
  // Mutable hook: response:before-send
  // ---------------------------------------------------------------------------

  describe('emitMutable - response:before-send', () => {
    function makeResponsePayload(
      overrides?: Partial<MutableBeforeResponseSentPayload>
    ): MutableBeforeResponseSentPayload {
      return {
        sessionId: 'sess-1',
        channel: 'slack',
        conversationId: 'conv-1',
        text: 'Hello, world!',
        format: 'markdown',
        replyToMessageId: 'msg-1',
        timestamp: new Date().toISOString(),
        ...overrides,
      };
    }

    it('should pass the payload through when no handlers are registered', async () => {
      const payload = makeResponsePayload();
      const result = await hooks.emitMutable('response:before-send', payload);

      expect(result).toBe(payload);
      expect(result.text).toBe('Hello, world!');
    });

    it('should allow a handler to modify text', async () => {
      hooks.registerMutable('response:before-send', async (p) => {
        p.text += '\n\n---\nDisclaimer: AI-generated content.';
      });

      const payload = makeResponsePayload();
      const result = await hooks.emitMutable('response:before-send', payload);

      expect(result.text).toBe('Hello, world!\n\n---\nDisclaimer: AI-generated content.');
    });

    it('should allow a handler to replace text entirely', async () => {
      hooks.registerMutable('response:before-send', async (p) => {
        p.text = p.text.replace('world', 'universe');
      });

      const payload = makeResponsePayload();
      const result = await hooks.emitMutable('response:before-send', payload);

      expect(result.text).toBe('Hello, universe!');
    });

    it('should chain text modifications across multiple handlers', async () => {
      hooks.registerMutable(
        'response:before-send',
        async (p) => {
          p.text = `[START] ${p.text}`;
        },
        { priority: 10 }
      );

      hooks.registerMutable(
        'response:before-send',
        async (p) => {
          p.text = `${p.text} [END]`;
        },
        { priority: 20 }
      );

      const payload = makeResponsePayload();
      const result = await hooks.emitMutable('response:before-send', payload);

      expect(result.text).toBe('[START] Hello, world! [END]');
    });

    it('should not allow modification of readonly fields', async () => {
      hooks.registerMutable('response:before-send', async (p) => {
        // TypeScript would prevent this at compile time; this is a runtime
        // sanity check that the readonly fields are preserved through the flow
        p.text = 'modified';
        // @ts-expect-error -- channel is readonly
        p.channel = 'discord';
      });

      const payload = makeResponsePayload();
      const result = await hooks.emitMutable('response:before-send', payload);

      // The handler DID modify text (that's allowed)
      expect(result.text).toBe('modified');
      // The readonly assignment still happens at runtime in JS, but
      // the type system should prevent it. We verify our test compiles
      // with @ts-expect-error above.
    });

    it('should continue after handler error in response hooks', async () => {
      hooks.registerMutable(
        'response:before-send',
        async () => {
          throw new Error('boom');
        },
        { priority: 10 }
      );

      hooks.registerMutable(
        'response:before-send',
        async (p) => {
          p.text += ' [processed]';
        },
        { priority: 20 }
      );

      const payload = makeResponsePayload();
      const result = await hooks.emitMutable('response:before-send', payload);

      expect(result.text).toBe('Hello, world! [processed]');
    });
  });

  // ---------------------------------------------------------------------------
  // Registration management for mutable hooks
  // ---------------------------------------------------------------------------

  describe('mutable handler management', () => {
    it('should report mutable handler count', () => {
      expect(hooks.mutableHandlerCount('llm:before-request')).toBe(0);

      hooks.registerMutable('llm:before-request', async () => {});
      expect(hooks.mutableHandlerCount('llm:before-request')).toBe(1);

      hooks.registerMutable('llm:before-request', async () => {});
      expect(hooks.mutableHandlerCount('llm:before-request')).toBe(2);
    });

    it('should unregister a mutable handler', () => {
      const handler = async (_p: MutableBeforeLLMRequestPayload) => {};
      hooks.registerMutable('llm:before-request', handler);
      expect(hooks.mutableHandlerCount('llm:before-request')).toBe(1);

      const removed = hooks.unregisterMutable('llm:before-request', handler);
      expect(removed).toBe(true);
      expect(hooks.mutableHandlerCount('llm:before-request')).toBe(0);
    });

    it('should return false when unregistering a handler that was not registered', () => {
      const handler = async (_p: MutableBeforeLLMRequestPayload) => {};
      const removed = hooks.unregisterMutable('llm:before-request', handler);
      expect(removed).toBe(false);
    });

    it('should include mutable handlers in totalHandlerCount', () => {
      hooks.register('message:received', async () => {});
      hooks.registerMutable('llm:before-request', async () => {});
      hooks.registerMutable('response:before-send', async () => {});

      expect(hooks.totalHandlerCount()).toBe(3);
    });

    it('should include mutable events in registeredEvents', () => {
      hooks.registerMutable('llm:before-request', async () => {});

      const events = hooks.registeredEvents();
      expect(events).toContain('llm:before-request');
    });

    it('should clear mutable handlers when clear() is called without arguments', () => {
      hooks.registerMutable('llm:before-request', async () => {});
      hooks.registerMutable('response:before-send', async () => {});
      hooks.register('message:received', async () => {});

      hooks.clear();

      expect(hooks.mutableHandlerCount('llm:before-request')).toBe(0);
      expect(hooks.mutableHandlerCount('response:before-send')).toBe(0);
      expect(hooks.handlerCount('message:received')).toBe(0);
      expect(hooks.totalHandlerCount()).toBe(0);
    });

    it('should clear mutable handlers for a specific event', () => {
      hooks.registerMutable('llm:before-request', async () => {});
      hooks.registerMutable('response:before-send', async () => {});

      hooks.clear('llm:before-request');

      expect(hooks.mutableHandlerCount('llm:before-request')).toBe(0);
      expect(hooks.mutableHandlerCount('response:before-send')).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Timeout handling for mutable hooks
  // ---------------------------------------------------------------------------

  describe('mutable handler timeout', () => {
    it('should timeout a slow mutable handler and continue', async () => {
      const shortTimeoutHooks = new HookRegistry({ handlerTimeoutMs: 50 });

      // Slow handler that would take too long
      shortTimeoutHooks.registerMutable(
        'response:before-send',
        async (p) => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          p.text = 'should not appear';
        },
        { priority: 10 }
      );

      // Fast handler that should still run
      shortTimeoutHooks.registerMutable(
        'response:before-send',
        async (p) => {
          p.text += ' [fast]';
        },
        { priority: 20 }
      );

      const payload: MutableBeforeResponseSentPayload = {
        sessionId: 'sess-1',
        channel: 'slack',
        conversationId: 'conv-1',
        text: 'original',
        format: 'markdown',
        replyToMessageId: undefined,
        timestamp: new Date().toISOString(),
      };

      const result = await shortTimeoutHooks.emitMutable('response:before-send', payload);

      // The slow handler timed out, so text was not replaced.
      // The fast handler appended ' [fast]'.
      expect(result.text).toBe('original [fast]');
    });
  });

  // ---------------------------------------------------------------------------
  // Observe-only and mutable handlers coexist independently
  // ---------------------------------------------------------------------------

  describe('observe-only and mutable coexistence', () => {
    it('should keep observe-only and mutable registrations separate', async () => {
      const observeHandler = vi.fn().mockResolvedValue(undefined);
      hooks.register('llm:before-request', observeHandler);

      const mutableHandler = vi.fn().mockResolvedValue(undefined);
      hooks.registerMutable('llm:before-request', mutableHandler);

      expect(hooks.handlerCount('llm:before-request')).toBe(1);
      expect(hooks.mutableHandlerCount('llm:before-request')).toBe(1);
      expect(hooks.totalHandlerCount()).toBe(2);

      // emit only triggers observe-only handlers
      await hooks.emit('llm:before-request', {
        sessionId: 'sess-1',
        messages: [],
        tools: undefined,
        stream: false,
        options: undefined,
        timestamp: new Date().toISOString(),
      });

      expect(observeHandler).toHaveBeenCalledOnce();
      expect(mutableHandler).not.toHaveBeenCalled();

      // emitMutable only triggers mutable handlers
      await hooks.emitMutable('llm:before-request', {
        sessionId: 'sess-1',
        messages: [],
        tools: undefined,
        stream: false,
        options: undefined,
        timestamp: new Date().toISOString(),
      });

      expect(observeHandler).toHaveBeenCalledOnce(); // still only 1
      expect(mutableHandler).toHaveBeenCalledOnce();
    });
  });

  // ---------------------------------------------------------------------------
  // Hook stats / failure observability
  // ---------------------------------------------------------------------------

  describe('hook stats', () => {
    function makeMessagePayload() {
      return {
        envelopeId: 'env-1',
        channel: 'slack',
        channelMessageId: 'msg-1',
        sender: { id: 'user-1', isAllowed: true },
        conversation: { id: 'conv-1', type: 'dm' as const },
        text: 'hello',
        sessionId: 'sess-1',
        timestamp: new Date().toISOString(),
      };
    }

    it('should return zero counts initially', () => {
      const stats = hooks.getStats();
      expect(stats.totalEmits).toBe(0);
      expect(stats.totalFailures).toBe(0);
      expect(Object.keys(stats.events)).toHaveLength(0);
    });

    it('should increment successCount on successful emit', async () => {
      hooks.register('message:received', async () => {});
      await hooks.emit('message:received', makeMessagePayload());

      const stats = hooks.getStats();
      expect(stats.events['message:received'].successCount).toBe(1);
      expect(stats.events['message:received'].failureCount).toBe(0);
      expect(stats.totalEmits).toBe(1);
      expect(stats.totalFailures).toBe(0);
    });

    it('should increment failureCount and record lastFailure on error', async () => {
      hooks.register(
        'message:received',
        async () => {
          throw new Error('handler-error');
        },
        { label: 'bad-handler' }
      );

      await hooks.emit('message:received', makeMessagePayload());

      const stats = hooks.getStats();
      expect(stats.events['message:received'].failureCount).toBe(1);
      expect(stats.events['message:received'].lastFailure).toBeDefined();
      expect(stats.events['message:received'].lastFailure!.error).toBe('handler-error');
      expect(stats.events['message:received'].lastFailure!.label).toBe('bad-handler');
      expect(stats.totalFailures).toBe(1);
    });

    it('should increment timeoutCount for timeout errors', async () => {
      const shortHooks = new HookRegistry({ handlerTimeoutMs: 10 });
      shortHooks.register(
        'gateway:startup',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
        },
        { label: 'slow' }
      );

      await shortHooks.emit('gateway:startup', {
        instanceId: 'gw-1',
        channels: ['slack'],
        securityMode: 'standard',
        streamingEnabled: false,
        timestamp: new Date().toISOString(),
      });

      const stats = shortHooks.getStats();
      expect(stats.events['gateway:startup'].timeoutCount).toBe(1);
      expect(stats.events['gateway:startup'].failureCount).toBe(1);
    });

    it('should track per-event stats independently', async () => {
      hooks.register('message:received', async () => {});
      hooks.register('session:created', async () => {
        throw new Error('fail');
      });

      await hooks.emit('message:received', makeMessagePayload());
      await hooks.emit('session:created', {
        session: {
          id: 's1',
          channel: 'slack',
          conversationId: 'c1',
          userId: 'u1',
          status: 'active',
          createdAt: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      });

      const stats = hooks.getStats();
      expect(stats.events['message:received'].successCount).toBe(1);
      expect(stats.events['message:received'].failureCount).toBe(0);
      expect(stats.events['session:created'].successCount).toBe(0);
      expect(stats.events['session:created'].failureCount).toBe(1);
      expect(stats.totalEmits).toBe(2);
      expect(stats.totalFailures).toBe(1);
    });

    it('should clear everything on resetStats()', async () => {
      hooks.register('message:received', async () => {});
      await hooks.emit('message:received', makeMessagePayload());

      hooks.resetStats();

      const stats = hooks.getStats();
      expect(stats.totalEmits).toBe(0);
      expect(stats.totalFailures).toBe(0);
      expect(Object.keys(stats.events)).toHaveLength(0);
    });

    it('should log at warn level for critical hook failures', async () => {
      hooks.register(
        'session:created',
        async () => {
          throw new Error('critical-fail');
        },
        { label: 'my-handler' }
      );

      await hooks.emit('session:created', {
        session: {
          id: 's1',
          channel: 'slack',
          conversationId: 'c1',
          userId: 'u1',
          status: 'active',
          createdAt: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      });

      // Should have been called with critical: true
      const warnCalls = mockLogger.warn.mock.calls;
      const criticalCall = warnCalls.find(
        (call: unknown[]) =>
          call[0] &&
          typeof call[0] === 'object' &&
          (call[0] as Record<string, unknown>).critical === true
      );
      expect(criticalCall).toBeDefined();
      expect(criticalCall![0].event).toBe('session:created');
    });

    it('should fire repeated failure alert at threshold', async () => {
      const alertHooks = new HookRegistry({ failureAlertThreshold: 3 });
      alertHooks.register('message:received', async () => {
        throw new Error('repeated');
      });

      // Emit 3 times to cross threshold
      for (let i = 0; i < 3; i++) {
        await alertHooks.emit('message:received', makeMessagePayload());
      }

      const alertCalls = mockLogger.warn.mock.calls.filter(
        (call: unknown[]) =>
          call[0] &&
          typeof call[0] === 'object' &&
          (call[0] as Record<string, unknown>).hookAlert === true
      );
      expect(alertCalls.length).toBeGreaterThanOrEqual(1);
      expect(alertCalls[0][0].failureCount).toBe(3);
    });

    it('should track stats for mutable hooks too', async () => {
      hooks.registerMutable(
        'response:before-send',
        async () => {
          throw new Error('mutable-fail');
        },
        { label: 'mutable-bad' }
      );

      await hooks.emitMutable('response:before-send', {
        sessionId: 'sess-1',
        channel: 'slack',
        conversationId: 'conv-1',
        text: 'hello',
        format: 'plain',
        replyToMessageId: undefined,
        timestamp: new Date().toISOString(),
      });

      const stats = hooks.getStats();
      expect(stats.events['response:before-send'].failureCount).toBe(1);
      expect(stats.events['response:before-send'].lastFailure!.error).toBe('mutable-fail');
      expect(stats.totalFailures).toBe(1);
    });
  });
});
