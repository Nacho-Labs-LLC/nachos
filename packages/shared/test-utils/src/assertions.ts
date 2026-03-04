/**
 * Custom assertion helpers for Nachos test suites.
 *
 * These helpers reduce boilerplate when asserting on bus messages,
 * tool results, and other common Nachos patterns. They are designed
 * to work with Vitest's expect API and the MockBus from this package.
 *
 * @example
 * ```typescript
 * import { createMockBus, expectPublished, expectNoPublished } from '@nachos/test-utils';
 *
 * const bus = createMockBus();
 * bus.publish('nachos.channel.slack.inbound', { text: 'hi' });
 *
 * expectPublished(bus, 'nachos.channel.slack.inbound', { text: 'hi' });
 * expectNoPublished(bus, 'nachos.channel.discord.inbound');
 * ```
 */

import type { MockBus } from './mock-bus.js';
import type { ToolResult } from '@nachos/types';

/**
 * Matcher function type. Receives a published message and returns
 * true if it matches the expected criteria.
 */
export type MessageMatcher = (message: unknown) => boolean;

/**
 * Assert that at least one message was published to the given topic.
 * If a matcher is provided, at least one published message must satisfy it.
 *
 * @param bus - The MockBus instance to check
 * @param topic - The topic to check for published messages
 * @param matcher - Optional matcher. Can be:
 *   - A plain object: performs a deep partial match (published message
 *     must contain all keys/values from the matcher object)
 *   - A function: called with each published message, must return true
 *     for at least one message
 * @throws AssertionError if no matching message is found
 */
export function expectPublished(
  bus: MockBus,
  topic: string,
  matcher?: Record<string, unknown> | MessageMatcher
): void {
  const messages = bus.getPublished(topic);

  if (messages.length === 0) {
    throw new Error(
      `Expected at least one message published to "${topic}", but none were found. ` +
        `Published topics: [${bus.getPublishedTopics().join(', ')}]`
    );
  }

  if (matcher === undefined) {
    return; // Just checking that something was published
  }

  if (typeof matcher === 'function') {
    const found = messages.some(matcher);
    if (!found) {
      throw new Error(
        `Expected a message on "${topic}" matching the provided function, ` +
          `but none of the ${messages.length} message(s) matched.`
      );
    }
    return;
  }

  // Object partial match
  const found = messages.some((msg) => deepPartialMatch(msg, matcher));
  if (!found) {
    throw new Error(
      `Expected a message on "${topic}" partially matching ${JSON.stringify(matcher)}, ` +
        `but none of the ${messages.length} message(s) matched. ` +
        `Published: ${JSON.stringify(messages, null, 2)}`
    );
  }
}

/**
 * Assert that no messages were published to the given topic.
 *
 * @param bus - The MockBus instance to check
 * @param topic - The topic that should have zero messages
 * @throws AssertionError if any messages were found
 */
export function expectNoPublished(bus: MockBus, topic: string): void {
  const messages = bus.getPublished(topic);
  if (messages.length > 0) {
    throw new Error(
      `Expected no messages published to "${topic}", ` +
        `but found ${messages.length}: ${JSON.stringify(messages, null, 2)}`
    );
  }
}

/**
 * Assert that exactly `count` messages were published to the given topic.
 *
 * @param bus - The MockBus instance to check
 * @param topic - The topic to check
 * @param count - The expected number of messages
 * @throws AssertionError if the count does not match
 */
export function expectPublishCount(bus: MockBus, topic: string, count: number): void {
  const messages = bus.getPublished(topic);
  if (messages.length !== count) {
    throw new Error(
      `Expected ${count} message(s) published to "${topic}", ` + `but found ${messages.length}.`
    );
  }
}

/**
 * Assert that a ToolResult indicates success.
 *
 * @param result - The ToolResult to check
 * @throws AssertionError if the result is not successful
 */
export function expectToolSuccess(result: ToolResult): void {
  if (!result.success) {
    throw new Error(
      `Expected tool result to be successful, but got failure: ` +
        `${result.error ? JSON.stringify(result.error) : 'no error details'}`
    );
  }
}

/**
 * Assert that a ToolResult indicates failure, optionally matching
 * the error code.
 *
 * @param result - The ToolResult to check
 * @param errorCode - Optional error code to match
 * @throws AssertionError if the result is successful or the error code
 *   does not match
 */
export function expectToolFailure(result: ToolResult, errorCode?: string): void {
  if (result.success) {
    throw new Error('Expected tool result to be a failure, but it was successful.');
  }

  if (errorCode !== undefined && result.error?.code !== errorCode) {
    throw new Error(
      `Expected tool error code "${errorCode}", ` +
        `but got "${result.error?.code ?? 'undefined'}".`
    );
  }
}

/**
 * Assert that a ToolResult contains text matching the given substring
 * or regex pattern.
 *
 * @param result - The ToolResult to check
 * @param pattern - A string (substring match) or RegExp to match
 *   against the text content blocks in the result
 * @throws AssertionError if no text content block matches
 */
export function expectToolResultContains(result: ToolResult, pattern: string | RegExp): void {
  const textBlocks = result.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text);

  if (textBlocks.length === 0) {
    throw new Error('Expected tool result to contain text content blocks, but none were found.');
  }

  const matches =
    typeof pattern === 'string'
      ? textBlocks.some((text) => text.includes(pattern))
      : textBlocks.some((text) => pattern.test(text));

  if (!matches) {
    throw new Error(
      `Expected tool result text to match ${typeof pattern === 'string' ? `"${pattern}"` : pattern}, ` +
        `but text blocks were: ${JSON.stringify(textBlocks)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Deep partial match: returns true if `actual` contains all
 * keys/values from `expected`. Supports nested objects.
 */
function deepPartialMatch(actual: unknown, expected: Record<string, unknown>): boolean {
  if (typeof actual !== 'object' || actual === null) {
    return false;
  }

  const actualObj = actual as Record<string, unknown>;

  for (const key of Object.keys(expected)) {
    if (!(key in actualObj)) {
      return false;
    }

    const expectedVal = expected[key];
    const actualVal = actualObj[key];

    if (typeof expectedVal === 'object' && expectedVal !== null && !Array.isArray(expectedVal)) {
      if (!deepPartialMatch(actualVal, expectedVal as Record<string, unknown>)) {
        return false;
      }
    } else if (actualVal !== expectedVal) {
      // Use JSON.stringify for array comparison
      if (
        Array.isArray(expectedVal) &&
        Array.isArray(actualVal) &&
        JSON.stringify(actualVal) === JSON.stringify(expectedVal)
      ) {
        continue;
      }
      return false;
    }
  }

  return true;
}
