/**
 * Mock NachosContext for testing channels and tools.
 *
 * Provides a pre-configured context object with:
 * - Silent logger (or optionally a capturing logger)
 * - Mock bus (from mock-bus.ts)
 * - Default config values
 *
 * @example
 * ```typescript
 * import { createMockContext } from '@nachos/test-utils';
 *
 * const ctx = createMockContext({ securityMode: 'strict' });
 * await myChannel.initialize({ ...ctx });
 * ```
 */

import { MockBus, createMockBus } from './mock-bus.js';

/**
 * Captured log entry for test assertions.
 */
export interface CapturedLogEntry {
  level: string;
  args: unknown[];
}

/**
 * Silent logger interface matching the subset of pino.Logger
 * used by Nachos components. All methods are no-ops.
 */
export interface MockLogger {
  trace: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  fatal: (...args: unknown[]) => void;
  child: (bindings: Record<string, unknown>) => MockLogger;
}

/**
 * A capturing logger that records all log calls for assertion.
 */
export interface CapturingLogger extends MockLogger {
  /** All captured log entries in order */
  entries: CapturedLogEntry[];

  /** Clear all captured entries */
  clear: () => void;
}

/**
 * Create a silent no-op logger. Useful when you don't need to
 * assert on log output.
 */
export function createSilentLogger(): MockLogger {
  const noop = () => {};
  const logger: MockLogger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  };
  return logger;
}

/**
 * Create a capturing logger that stores every log call.
 * Useful when you want to assert that a component logged
 * a specific warning or error.
 */
export function createCapturingLogger(): CapturingLogger {
  const entries: CapturedLogEntry[] = [];

  function makeLogFn(level: string) {
    return (...args: unknown[]) => {
      entries.push({ level, args });
    };
  }

  const logger: CapturingLogger = {
    entries,
    clear: () => {
      entries.length = 0;
    },
    trace: makeLogFn('trace'),
    debug: makeLogFn('debug'),
    info: makeLogFn('info'),
    warn: makeLogFn('warn'),
    error: makeLogFn('error'),
    fatal: makeLogFn('fatal'),
    child: () => logger,
  };
  return logger;
}

/**
 * Configuration options for the mock context.
 */
export interface MockContextOptions {
  /** Security mode. Defaults to 'standard'. */
  securityMode?: 'strict' | 'standard' | 'permissive';

  /** Additional config values merged into `config`. */
  config?: Record<string, unknown>;

  /** Additional secrets merged into `secrets`. */
  secrets?: Record<string, string>;

  /** Provide a custom MockBus instance. If omitted, a fresh one is created. */
  bus?: MockBus;

  /** Logger mode. Defaults to 'silent'. */
  loggerMode?: 'silent' | 'capturing';
}

/**
 * Mock context shape matching what channels and tools receive
 * during initialization (ChannelAdapterConfig).
 */
export interface MockContext {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  bus: MockBus;
  securityMode: 'strict' | 'standard' | 'permissive';
  logger: MockLogger | CapturingLogger;
}

/**
 * Create a mock context suitable for passing to channel adapters
 * and tool initialization methods.
 *
 * The returned object has the same shape as `ChannelAdapterConfig`
 * with an additional `logger` property.
 */
export function createMockContext(options: MockContextOptions = {}): MockContext {
  const bus = options.bus ?? createMockBus();
  const logger =
    options.loggerMode === 'capturing' ? createCapturingLogger() : createSilentLogger();

  return {
    config: options.config ?? {},
    secrets: options.secrets ?? {},
    bus,
    securityMode: options.securityMode ?? 'standard',
    logger,
  };
}
