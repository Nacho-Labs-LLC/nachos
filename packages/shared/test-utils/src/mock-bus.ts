/**
 * Mock Message Bus for testing Nachos channels and tools in isolation.
 *
 * Implements the same MessageBus interface used by the gateway's
 * InMemoryMessageBus, plus tracking methods for test assertions.
 *
 * @example
 * ```typescript
 * import { MockBus } from '@nachos/test-utils';
 *
 * const bus = new MockBus();
 * bus.publish('nachos.channel.slack.inbound', payload);
 *
 * const published = bus.getPublished('nachos.channel.slack.inbound');
 * expect(published).toHaveLength(1);
 * expect(published[0]).toEqual(payload);
 * ```
 */

/**
 * Minimal MessageBus interface matching the gateway's contract.
 * Channels and tools depend on this shape for bus communication.
 */
export interface MessageBus {
  publish(topic: string, data: unknown): void | Promise<void>;
  subscribe(topic: string, handler: (data: unknown) => void | Promise<void>): Promise<void>;
  request(topic: string, data: unknown, timeout?: number): Promise<unknown>;
  unsubscribe(topic: string): Promise<void>;
}

/**
 * Subscription handler type for mock bus subscriptions.
 */
type SubscriptionHandler = (data: unknown) => void | Promise<void>;

/**
 * Configuration for canned request/reply responses.
 */
export interface MockRequestResponse {
  /** Topic pattern (exact match) */
  topic: string;
  /** The response to return when a request is made to this topic */
  response: unknown;
}

/**
 * Mock message bus that records all published messages and supports
 * configurable subscriptions and request/reply responses.
 *
 * This is the primary testing utility for verifying that channels
 * and tools communicate correctly over the bus without requiring
 * a live NATS connection or the full Docker stack.
 */
export class MockBus implements MessageBus {
  /** Messages published to each topic, keyed by topic string */
  private published: Map<string, unknown[]> = new Map();

  /** Active subscription handlers, keyed by topic string */
  private handlers: Map<string, Set<SubscriptionHandler>> = new Map();

  /** Canned request/reply responses, keyed by topic string */
  private requestResponses: Map<string, unknown> = new Map();

  /**
   * Publish a message to a topic.
   * Records the payload for later assertion and dispatches
   * to any registered subscription handlers.
   */
  async publish(topic: string, data: unknown): Promise<void> {
    // Record for assertions
    if (!this.published.has(topic)) {
      this.published.set(topic, []);
    }
    this.published.get(topic)!.push(data);

    // Dispatch to handlers
    const topicHandlers = this.handlers.get(topic);
    if (topicHandlers) {
      for (const handler of topicHandlers) {
        await handler(data);
      }
    }
  }

  /**
   * Subscribe to a topic. The handler will be invoked for every
   * subsequent publish to this topic.
   */
  async subscribe(topic: string, handler: (data: unknown) => void | Promise<void>): Promise<void> {
    if (!this.handlers.has(topic)) {
      this.handlers.set(topic, new Set());
    }
    this.handlers.get(topic)!.add(handler);
  }

  /**
   * Request/reply pattern. Returns a canned response if one has been
   * configured via `setRequestResponse`, otherwise returns `{ success: true }`.
   */
  async request(topic: string, _data: unknown, _timeout?: number): Promise<unknown> {
    if (this.requestResponses.has(topic)) {
      return this.requestResponses.get(topic);
    }
    return { success: true };
  }

  /**
   * Remove all subscription handlers for a topic.
   */
  async unsubscribe(topic: string): Promise<void> {
    this.handlers.delete(topic);
  }

  // ---------------------------------------------------------------------------
  // Test helper methods
  // ---------------------------------------------------------------------------

  /**
   * Get all messages published to a specific topic.
   * Returns an empty array if no messages have been published.
   */
  getPublished(topic: string): unknown[] {
    return this.published.get(topic) ?? [];
  }

  /**
   * Get messages published to a topic, typed.
   * Convenience wrapper around `getPublished` for when you know the payload shape.
   */
  getPublishedAs<T>(topic: string): T[] {
    return (this.published.get(topic) ?? []) as T[];
  }

  /**
   * Get all published messages across all topics, returned as
   * an array of `{ topic, data }` records in publication order is
   * not guaranteed across topics. Use `getPublished(topic)` for
   * per-topic ordering (which is preserved).
   */
  getAllPublished(): Array<{ topic: string; data: unknown }> {
    const result: Array<{ topic: string; data: unknown }> = [];
    for (const [topic, messages] of this.published.entries()) {
      for (const data of messages) {
        result.push({ topic, data });
      }
    }
    return result;
  }

  /**
   * Get the total number of messages published across all topics.
   */
  getPublishCount(): number {
    let count = 0;
    for (const messages of this.published.values()) {
      count += messages.length;
    }
    return count;
  }

  /**
   * Get all topics that have received at least one published message.
   */
  getPublishedTopics(): string[] {
    return [...this.published.keys()];
  }

  /**
   * Configure a canned response for the request/reply pattern.
   * When `request(topic, ...)` is called, this response will be returned.
   */
  setRequestResponse(topic: string, response: unknown): void {
    this.requestResponses.set(topic, response);
  }

  /**
   * Clear all state: published messages, subscription handlers,
   * and request/reply responses.
   */
  reset(): void {
    this.published.clear();
    this.handlers.clear();
    this.requestResponses.clear();
  }

  /**
   * Clear only published messages, keeping subscriptions and
   * request responses intact. Useful between test assertions
   * within the same test case.
   */
  clearPublished(): void {
    this.published.clear();
  }
}

/**
 * Create a new MockBus instance. Convenience factory function.
 */
export function createMockBus(): MockBus {
  return new MockBus();
}
