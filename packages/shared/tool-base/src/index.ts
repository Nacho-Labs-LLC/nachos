/**
 * @nachos/tool-base
 *
 * Base classes and utilities for building NACHOS tools
 */

// Export ToolService base class
export {
  ToolService,
  type ToolServiceConfig,
  type Logger,
} from './tool-service.js';

// Export NATS utilities
export {
  connectToNats,
  createEnvelope,
  parseEnvelope,
  serializeEnvelope,
  waitForReady,
  closeNats,
  setupShutdownHandlers,
} from './nats-utils.js';
