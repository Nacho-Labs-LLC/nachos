/**
 * Nachos Gateway
 *
 * Central orchestrator for session management, message routing,
 * and coordination between channels, LLM, and tools.
 */

// Main Gateway class
export { Gateway, type GatewayOptions } from './gateway.js';

// Configuration
export { loadConfig, validateConfig, type GatewayConfig } from './config.js';

// Security - DLP
export {
  DLPSecurityLayer,
  createDefaultDLPConfig,
  type DLPConfig,
  type DLPPolicy,
  type DLPAction,
  type ChannelDLPConfig,
  type DLPScanResult,
} from './security/dlp.js';

// Security - Rate limiting
export {
  RateLimiter,
  createDefaultRateLimiterConfig,
  type RateLimiterConfig,
  type RateLimiterLimits,
  type RateLimitAction,
  type RateLimitCheckResult,
  type RateLimitPresets,
} from './security/rate-limiter.js';

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
  NatsBusAdapter,
  Topics,
  createEnvelope,
  type MessageBus,
  type RouteHandler,
  type RouterOptions,
} from './router.js';

// Re-export TOPICS from @nachos/bus for convenience
export { TOPICS } from '@nachos/bus';

// Audit logging
export {
  AuditLogger,
  loadAuditProvider,
  CompositeAuditProvider,
  FileAuditProvider,
  SQLiteAuditProvider,
  WebhookAuditProvider,
  type AuditEvent,
  type AuditEventType,
  type AuditOutcome,
  type AuditProvider,
  type AuditQueryFilter,
} from './audit/index.js';

// Health check
export {
  createHealthServer,
  performHealthCheck,
  getUptime,
  resetStartTime,
  type HealthCheckDeps,
  type HealthServerOptions,
} from './health.js';
