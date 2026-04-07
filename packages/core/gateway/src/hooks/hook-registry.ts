/**
 * HookRegistry -- Typed lifecycle hook registry for the Nachos Gateway.
 *
 * Provides a simple, priority-ordered event emitter pattern. Handlers are
 * invoked sequentially in ascending priority order. Errors in individual
 * handlers are caught and logged -- they never crash the gateway or prevent
 * subsequent handlers from running.
 *
 * Usage:
 *   const hooks = new HookRegistry();
 *   hooks.register('message:received', async (event) => {
 *     logger.info({ channel: event.channel }, 'Message received');
 *   });
 *   await hooks.emit('message:received', payload);
 */
import { createLogger } from '@nachos/types';
import type {
  HookEvent,
  HookEventStats,
  HookHandler,
  HookPayloadMap,
  HookRegistration,
  HookStats,
  MutableHookEvent,
  MutableHookHandler,
  MutableHookPayloadMap,
  MutableHookRegistration,
} from './hook-types.js';

const logger = createLogger('hook-registry');

/** Default execution priority for handlers */
const DEFAULT_PRIORITY = 100;

/** Default per-handler timeout in milliseconds */
const DEFAULT_HANDLER_TIMEOUT_MS = 5000;

/** Default failure count before a summary alert is logged */
const DEFAULT_FAILURE_ALERT_THRESHOLD = 5;

/**
 * Hook events considered critical for gateway operation.
 * Failures on these hooks generate an additional structured warn log
 * with `critical: true` to simplify alerting.
 */
const CRITICAL_HOOKS: Set<string> = new Set([
  'session:created',
  'message:received',
  'gateway:startup',
  'gateway:shutdown',
]);

/**
 * Options for configuring a HookRegistry instance.
 */
export interface HookRegistryOptions {
  /**
   * Maximum time in milliseconds that a single handler is allowed to run
   * before being considered timed out. Default: 5000.
   */
  handlerTimeoutMs?: number;

  /**
   * Number of failures for a single event before a summary alert is logged.
   * The alert fires once per threshold crossing. Default: 5.
   */
  failureAlertThreshold?: number;
}

/**
 * Options when registering a hook handler.
 */
export interface RegisterOptions {
  /**
   * Execution priority. Lower values execute first. Default: 100.
   */
  priority?: number;
  /**
   * Optional human-readable label for logging and debugging.
   */
  label?: string;
}

/**
 * HookRegistry manages typed lifecycle hook handlers.
 */
export class HookRegistry {
  /** Map from event name to sorted array of registrations */
  private registrations: Map<string, HookRegistration<HookEvent>[]> = new Map();

  /** Map from event name to sorted array of mutable registrations */
  private mutableRegistrations: Map<string, MutableHookRegistration<MutableHookEvent>[]> =
    new Map();

  /** Per-handler timeout */
  private handlerTimeoutMs: number;

  /** Per-event failure/success statistics */
  private stats: Map<string, HookEventStats> = new Map();

  /** Failure threshold for repeated-failure alerting */
  private failureAlertThreshold: number;

  /** Tracks the last failure count at which an alert was fired per event */
  private lastAlertedAt: Map<string, number> = new Map();

  constructor(options?: HookRegistryOptions) {
    this.handlerTimeoutMs = options?.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS;
    this.failureAlertThreshold = options?.failureAlertThreshold ?? DEFAULT_FAILURE_ALERT_THRESHOLD;
  }

  /**
   * Register a handler for a specific hook event.
   *
   * @param event - The hook event name
   * @param handler - Async handler function that receives the typed event payload
   * @param options - Registration options (priority, label)
   */
  register<E extends HookEvent>(
    event: E,
    handler: HookHandler<E>,
    options?: RegisterOptions | number
  ): void {
    // Support legacy signature: register(event, handler, priority)
    const opts: RegisterOptions =
      typeof options === 'number' ? { priority: options } : (options ?? {});

    const registration: HookRegistration<E> = {
      handler,
      priority: opts.priority ?? DEFAULT_PRIORITY,
      label: opts.label,
    };

    let list = this.registrations.get(event);
    if (!list) {
      list = [];
      this.registrations.set(event, list);
    }

    list.push(registration as HookRegistration<HookEvent>);
    // Maintain sorted order by priority (ascending)
    list.sort((a, b) => a.priority - b.priority);

    logger.debug(
      { event, priority: registration.priority, label: registration.label },
      'Hook handler registered'
    );
  }

  /**
   * Remove a previously registered handler.
   *
   * @returns true if the handler was found and removed, false otherwise
   */
  unregister<E extends HookEvent>(event: E, handler: HookHandler<E>): boolean {
    const list = this.registrations.get(event);
    if (!list) return false;

    const index = list.findIndex((r) => r.handler === handler);
    if (index === -1) return false;

    const removed = list[index];
    list.splice(index, 1);

    // Clean up empty lists
    if (list.length === 0) {
      this.registrations.delete(event);
    }

    logger.debug({ event, label: removed?.label }, 'Hook handler unregistered');
    return true;
  }

  /**
   * Emit an event to all registered handlers in priority order.
   *
   * Handlers execute sequentially. If a handler throws or times out,
   * the error is logged and execution continues with the next handler.
   *
   * @returns The number of handlers that executed successfully
   */
  async emit<E extends HookEvent>(event: E, payload: HookPayloadMap[E]): Promise<number> {
    const list = this.registrations.get(event);
    if (!list || list.length === 0) return 0;

    let successCount = 0;

    for (const registration of list) {
      const label = registration.label ?? '(anonymous)';
      try {
        await this.executeWithTimeout(
          registration.handler(payload as HookPayloadMap[HookEvent]),
          this.handlerTimeoutMs,
          event,
          label
        );
        successCount++;
        this.recordSuccess(event);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isTimeout = errorMessage.includes('timed out');
        this.recordFailure(event, label, errorMessage, isTimeout);

        logger.error(
          {
            event,
            label,
            priority: registration.priority,
            err: error instanceof Error ? error : new Error(String(error)),
          },
          'Hook handler failed'
        );

        if (CRITICAL_HOOKS.has(event)) {
          logger.warn(
            { event, label, critical: true, errorMessage },
            'Critical hook handler failed'
          );
        }
      }
    }

    return successCount;
  }

  // -------------------------------------------------------------------------
  // Mutable hook methods
  // -------------------------------------------------------------------------

  /**
   * Register a mutable handler for a specific hook event.
   *
   * Mutable handlers receive a payload they can modify in place. They run
   * sequentially in priority order so each handler sees the previous
   * handler's modifications.
   *
   * @param event - The mutable hook event name
   * @param handler - Async handler that receives a mutable payload
   * @param options - Registration options (priority, label)
   */
  registerMutable<E extends MutableHookEvent>(
    event: E,
    handler: MutableHookHandler<E>,
    options?: RegisterOptions | number
  ): void {
    const opts: RegisterOptions =
      typeof options === 'number' ? { priority: options } : (options ?? {});

    const registration: MutableHookRegistration<E> = {
      handler,
      priority: opts.priority ?? DEFAULT_PRIORITY,
      label: opts.label,
    };

    let list = this.mutableRegistrations.get(event);
    if (!list) {
      list = [];
      this.mutableRegistrations.set(event, list);
    }

    list.push(registration as MutableHookRegistration<MutableHookEvent>);
    // Maintain sorted order by priority (ascending)
    list.sort((a, b) => a.priority - b.priority);

    logger.debug(
      { event, priority: registration.priority, label: registration.label },
      'Mutable hook handler registered'
    );
  }

  /**
   * Remove a previously registered mutable handler.
   *
   * @returns true if the handler was found and removed, false otherwise
   */
  unregisterMutable<E extends MutableHookEvent>(event: E, handler: MutableHookHandler<E>): boolean {
    const list = this.mutableRegistrations.get(event);
    if (!list) return false;

    const index = list.findIndex((r) => r.handler === handler);
    if (index === -1) return false;

    const removed = list[index];
    list.splice(index, 1);

    if (list.length === 0) {
      this.mutableRegistrations.delete(event);
    }

    logger.debug({ event, label: removed?.label }, 'Mutable hook handler unregistered');
    return true;
  }

  /**
   * Emit a mutable event, passing the payload through all registered mutable
   * handlers sequentially in priority order. Each handler may modify the
   * payload in place; the next handler sees the previous handler's changes.
   *
   * If a handler throws or times out, the error is logged and execution
   * continues with the next handler. The payload retains whatever modifications
   * were applied before the error.
   *
   * @returns The (potentially modified) payload after all handlers have run
   */
  async emitMutable<E extends MutableHookEvent>(
    event: E,
    payload: MutableHookPayloadMap[E]
  ): Promise<MutableHookPayloadMap[E]> {
    const list = this.mutableRegistrations.get(event);
    if (!list || list.length === 0) return payload;

    for (const registration of list) {
      const label = registration.label ?? '(anonymous)';
      try {
        await this.executeWithTimeout(
          registration.handler(payload as MutableHookPayloadMap[MutableHookEvent]),
          this.handlerTimeoutMs,
          event,
          label
        );
        this.recordSuccess(event);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isTimeout = errorMessage.includes('timed out');
        this.recordFailure(event, label, errorMessage, isTimeout);

        logger.error(
          {
            event,
            label,
            priority: registration.priority,
            err: error instanceof Error ? error : new Error(String(error)),
          },
          'Mutable hook handler failed'
        );

        if (CRITICAL_HOOKS.has(event)) {
          logger.warn(
            { event, label, critical: true, errorMessage },
            'Critical hook handler failed'
          );
        }
      }
    }

    return payload;
  }

  /**
   * Get the count of registered mutable handlers for a specific event.
   */
  mutableHandlerCount(event: MutableHookEvent): number {
    return this.mutableRegistrations.get(event)?.length ?? 0;
  }

  /**
   * Remove all handlers for a specific event, or all handlers for all events.
   */
  clear(event?: HookEvent): void {
    if (event) {
      this.registrations.delete(event);
      this.mutableRegistrations.delete(event);
      logger.debug({ event }, 'Hook handlers cleared for event');
    } else {
      this.registrations.clear();
      this.mutableRegistrations.clear();
      logger.debug('All hook handlers cleared');
    }
  }

  /**
   * Get the count of registered handlers for a specific event.
   */
  handlerCount(event: HookEvent): number {
    return this.registrations.get(event)?.length ?? 0;
  }

  /**
   * Get the total count of registered handlers across all events.
   */
  totalHandlerCount(): number {
    let total = 0;
    for (const list of this.registrations.values()) {
      total += list.length;
    }
    for (const list of this.mutableRegistrations.values()) {
      total += list.length;
    }
    return total;
  }

  /**
   * Get all events that have at least one registered handler (observe-only or mutable).
   */
  registeredEvents(): HookEvent[] {
    const events = new Set<string>(this.registrations.keys());
    for (const key of this.mutableRegistrations.keys()) {
      events.add(key);
    }
    return Array.from(events) as HookEvent[];
  }

  // -------------------------------------------------------------------------
  // Stats / observability
  // -------------------------------------------------------------------------

  /**
   * Returns a snapshot of all per-event hook statistics plus aggregated totals.
   */
  getStats(): HookStats {
    const events: Record<string, HookEventStats> = {};
    let totalEmits = 0;
    let totalFailures = 0;

    for (const [event, eventStats] of this.stats) {
      events[event] = {
        ...eventStats,
        lastFailure: eventStats.lastFailure ? { ...eventStats.lastFailure } : undefined,
      };
      totalEmits += eventStats.successCount + eventStats.failureCount;
      totalFailures += eventStats.failureCount;
    }

    return { events, totalEmits, totalFailures };
  }

  /**
   * Reset all statistics. Primarily useful for testing.
   */
  resetStats(): void {
    this.stats.clear();
    this.lastAlertedAt.clear();
  }

  /** Get or create the stats entry for an event */
  private getOrCreateEventStats(event: string): HookEventStats {
    let eventStats = this.stats.get(event);
    if (!eventStats) {
      eventStats = { successCount: 0, failureCount: 0, timeoutCount: 0 };
      this.stats.set(event, eventStats);
    }
    return eventStats;
  }

  /** Record a successful handler execution */
  private recordSuccess(event: string): void {
    this.getOrCreateEventStats(event).successCount++;
  }

  /** Record a handler failure with optional timeout tracking and alerting */
  private recordFailure(
    event: string,
    label: string,
    errorMessage: string,
    isTimeout: boolean
  ): void {
    const eventStats = this.getOrCreateEventStats(event);
    eventStats.failureCount++;
    eventStats.lastFailure = { error: errorMessage, label, timestamp: new Date().toISOString() };
    if (isTimeout) {
      eventStats.timeoutCount++;
    }

    // Check repeated-failure alert threshold
    const lastAlerted = this.lastAlertedAt.get(event) ?? 0;
    const nextThreshold = lastAlerted + this.failureAlertThreshold;
    if (eventStats.failureCount >= nextThreshold) {
      logger.warn(
        {
          event,
          hookAlert: true,
          failureCount: eventStats.failureCount,
          timeoutCount: eventStats.timeoutCount,
          lastFailure: eventStats.lastFailure,
        },
        `Hook "${event}" has reached ${eventStats.failureCount} failures`
      );
      this.lastAlertedAt.set(event, eventStats.failureCount);
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Execute a promise with a timeout. If the promise does not resolve within
   * the given duration, it is treated as a failure.
   */
  private async executeWithTimeout(
    promise: Promise<void>,
    timeoutMs: number,
    event: string,
    label: string
  ): Promise<void> {
    if (timeoutMs <= 0) {
      await promise;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(
            new Error(
              `Hook handler timed out after ${timeoutMs}ms [event=${event}, handler=${label}]`
            )
          );
        }
      }, timeoutMs);

      promise
        .then(() => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve();
          }
        })
        .catch((error: unknown) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(error);
          }
        });
    });
  }
}
