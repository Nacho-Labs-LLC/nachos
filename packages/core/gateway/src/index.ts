/**
 * Nachos Gateway
 *
 * Central orchestrator for session management, message routing,
 * and coordination between channels, LLM, and tools.
 */

// Main Gateway class
export { Gateway, type GatewayOptions } from './gateway.js';

// Session management
export { SessionManager, type CreateSessionOptions, type AddMessageOptions } from './session.js';

// State storage
export {
  StateStorage,
  type CreateSessionData,
  type UpdateSessionData,
  type CreateMessageData,
} from './state.js';

// Router and message bus
export {
  Router,
  InMemoryMessageBus,
  Topics,
  createEnvelope,
  type MessageBus,
  type RouteHandler,
  type RouterOptions,
} from './router.js';

// Health check
export {
  createHealthServer,
  performHealthCheck,
  getUptime,
  resetStartTime,
  type HealthCheckDeps,
  type HealthServerOptions,
} from './health.js';
