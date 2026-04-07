import { describe, it, expect } from 'vitest';
import { createMockContext, createSilentLogger, createCapturingLogger } from './mock-context.js';
import { MockBus } from './mock-bus.js';

describe('createSilentLogger', () => {
  it('should create a logger where all methods are no-ops', () => {
    const logger = createSilentLogger();

    // Should not throw
    logger.trace('trace message');
    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');
    logger.fatal('fatal message');
  });

  it('should support child loggers', () => {
    const logger = createSilentLogger();
    const child = logger.child({ component: 'test' });

    expect(child).toBeDefined();
    child.info('child message'); // Should not throw
  });
});

describe('createCapturingLogger', () => {
  it('should capture all log entries', () => {
    const logger = createCapturingLogger();

    logger.info('first');
    logger.warn({ code: 'W1' }, 'second');
    logger.error('third');

    expect(logger.entries).toHaveLength(3);
    expect(logger.entries[0]).toEqual({
      level: 'info',
      args: ['first'],
    });
    expect(logger.entries[1]).toEqual({
      level: 'warn',
      args: [{ code: 'W1' }, 'second'],
    });
    expect(logger.entries[2]).toEqual({
      level: 'error',
      args: ['third'],
    });
  });

  it('should clear captured entries', () => {
    const logger = createCapturingLogger();

    logger.info('message');
    expect(logger.entries).toHaveLength(1);

    logger.clear();
    expect(logger.entries).toHaveLength(0);
  });

  it('should support child loggers that share the same capture buffer', () => {
    const logger = createCapturingLogger();
    const child = logger.child({ component: 'sub' });

    child.info('from child');

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]?.level).toBe('info');
  });
});

describe('createMockContext', () => {
  it('should create a context with default values', () => {
    const ctx = createMockContext();

    expect(ctx.config).toEqual({});
    expect(ctx.secrets).toEqual({});
    expect(ctx.securityMode).toBe('standard');
    expect(ctx.bus).toBeInstanceOf(MockBus);
    expect(ctx.logger).toBeDefined();
  });

  it('should use a silent logger by default', () => {
    const ctx = createMockContext();

    // Silent logger should not throw
    ctx.logger.info('silent');
    ctx.logger.error('silent error');
  });

  it('should allow capturing logger mode', () => {
    const ctx = createMockContext({ loggerMode: 'capturing' });

    ctx.logger.warn('test warning');

    const capturing = ctx.logger as ReturnType<typeof createCapturingLogger>;
    expect(capturing.entries).toHaveLength(1);
    expect(capturing.entries[0]?.level).toBe('warn');
  });

  it('should allow custom security mode', () => {
    const ctx = createMockContext({ securityMode: 'strict' });
    expect(ctx.securityMode).toBe('strict');
  });

  it('should allow custom config and secrets', () => {
    const ctx = createMockContext({
      config: { dm: { user_allowlist: ['U1'] } },
      secrets: { SLACK_BOT_TOKEN: 'xoxb-test' },
    });

    expect(ctx.config).toEqual({ dm: { user_allowlist: ['U1'] } });
    expect(ctx.secrets).toEqual({ SLACK_BOT_TOKEN: 'xoxb-test' });
  });

  it('should allow injecting a custom bus', () => {
    const customBus = new MockBus();
    const ctx = createMockContext({ bus: customBus });

    expect(ctx.bus).toBe(customBus);
  });

  it('should have a shape compatible with ChannelAdapterConfig', () => {
    const ctx = createMockContext();

    // This verifies the shape matches what channel adapters expect
    const adapterConfig: {
      config: Record<string, unknown>;
      secrets: Record<string, string>;
      bus: {
        publish: (topic: string, payload: unknown) => void | Promise<void>;
        subscribe: (topic: string, handler: (payload: unknown) => void) => Promise<unknown>;
      };
      securityMode: 'strict' | 'standard' | 'permissive';
    } = {
      config: ctx.config,
      secrets: ctx.secrets,
      bus: ctx.bus,
      securityMode: ctx.securityMode,
    };

    expect(adapterConfig).toBeDefined();
  });
});
