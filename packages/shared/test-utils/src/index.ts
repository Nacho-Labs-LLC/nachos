/**
 * @nachos/test-utils - Testing utilities for Nachos plugin development
 *
 * This package provides mock implementations, test data factories, and
 * assertion helpers so that channel adapters and tools can be tested
 * in isolation without Docker or a live NATS connection.
 *
 * @example
 * ```typescript
 * import {
 *   // Mock bus
 *   MockBus,
 *   createMockBus,
 *
 *   // Factories
 *   createTestSession,
 *   createInboundMessage,
 *   createToolResult,
 *
 *   // Context
 *   createMockContext,
 *
 *   // Assertions
 *   expectPublished,
 *   expectNoPublished,
 *   expectToolSuccess,
 * } from '@nachos/test-utils';
 * ```
 */

// ============================================================================
// Mock Bus
// ============================================================================

export { MockBus, createMockBus } from './mock-bus.js';
export type { MessageBus, MockRequestResponse } from './mock-bus.js';

// ============================================================================
// Test Data Factories
// ============================================================================

export {
  // Object factories
  createTestSession,
  createTestMessage,
  createInboundMessage,
  createOutboundMessage,
  createToolRequest,
  createToolResponse,
  createToolResult,
  createToolCall,
  createMessageEnvelope,
  createTextBlock,

  // State management
  resetFactories,
  resetIdCounter,
} from './factories.js';

// ============================================================================
// Mock Context
// ============================================================================

export { createMockContext, createSilentLogger, createCapturingLogger } from './mock-context.js';
export type {
  MockContext,
  MockContextOptions,
  MockLogger,
  CapturingLogger,
  CapturedLogEntry,
} from './mock-context.js';

// ============================================================================
// Assertion Helpers
// ============================================================================

export {
  expectPublished,
  expectNoPublished,
  expectPublishCount,
  expectToolSuccess,
  expectToolFailure,
  expectToolResultContains,
} from './assertions.js';
export type { MessageMatcher } from './assertions.js';
