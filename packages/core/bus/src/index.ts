/**
 * @nachos/bus - NATS-based message bus for Nachos
 *
 * This package provides:
 * - TypeScript client wrapper for NATS
 * - Topic structure constants
 * - Request/reply pattern helpers
 * - Health check functionality
 *
 * @example
 * ```typescript
 * import { createBusClient, TOPICS } from '@nachos/bus';
 *
 * const client = createBusClient({
 *   servers: 'nats://localhost:4222',
 *   name: 'my-component',
 * });
 *
 * await client.connect();
 *
 * // Subscribe to channel messages
 * await client.subscribe(TOPICS.channel.inbound('slack'), async (msg) => {
 *   console.log('Received:', msg.payload);
 * });
 *
 * // Publish a response
 * client.publish(TOPICS.channel.outbound('slack'), { text: 'Hello!' });
 *
 * // Request/reply
 * const response = await client.request(TOPICS.policy.check, { action: 'read' });
 * console.log('Policy decision:', response.payload);
 * ```
 */

// Client
export { NachosBusClient, createBusClient } from './client.js';

// Topics
export {
  TOPICS,
  TOPIC_PREFIX,
  CHANNEL_TOPICS,
  LLM_TOPICS,
  TOOL_TOPICS,
  POLICY_TOPICS,
  AUDIT_TOPICS,
  HEALTH_TOPICS,
  extractChannelFromTopic,
  extractToolFromTopic,
  extractSessionFromStreamTopic,
} from './topics.js';

// Types
export type {
  MessageEnvelope,
  NachosBusOptions,
  PublishOptions,
  SubscribeOptions,
  RequestOptions,
  MessageHandler,
  BusSubscription,
  BusHealthStatus,
  INachosBusClient,
  BusEvent,
  BusEventHandler,
} from './types.js';
