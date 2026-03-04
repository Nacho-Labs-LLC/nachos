/**
 * Gateway Lifecycle Hooks
 *
 * Typed event-based hook system for the Nachos Gateway. Plugin developers
 * register handlers for lifecycle events (messages, LLM requests, tool calls,
 * sessions, startup/shutdown) without modifying core gateway code.
 *
 * @example
 * ```typescript
 * import { HookRegistry } from './hooks/index.js';
 * import type { HookEvent, MessageReceivedEvent } from './hooks/index.js';
 *
 * const hooks = new HookRegistry();
 *
 * hooks.register('message:received', async (event) => {
 *   console.log(`Message from ${event.sender.id} in ${event.channel}`);
 * }, { priority: 50, label: 'analytics' });
 *
 * // Later, in gateway flow:
 * await hooks.emit('message:received', payload);
 * ```
 */

// Registry
export { HookRegistry } from './hook-registry.js';
export type { HookRegistryOptions, RegisterOptions } from './hook-registry.js';

// Types -- event payloads
export type {
  // Message flow events
  MessageReceivedEvent,
  BeforeLLMRequestEvent,
  AfterLLMResponseEvent,
  ToolCallEvent,
  AfterToolCallEvent,
  BeforeResponseSentEvent,

  // Session lifecycle events
  SessionCreatedEvent,
  SessionDestroyedEvent,

  // Gateway lifecycle events
  StartupEvent,
  ShutdownEvent,

  // Core mapping types
  HookPayloadMap,
  HookEvent,
  HookHandler,
  HookRegistration,

  // Mutable hook types
  MutableBeforeLLMRequestPayload,
  MutableBeforeResponseSentPayload,
  MutableHookPayloadMap,
  MutableHookEvent,
  MutableHookHandler,
  MutableHookRegistration,
} from './hook-types.js';
