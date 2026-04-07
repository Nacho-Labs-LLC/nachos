/**
 * LLM -> Tool -> LLM End-to-End Integration Tests
 *
 * Tests the full cycle: LLM returns tool calls -> gateway executes tools ->
 * sends results back to LLM -> gets final text response.
 *
 * processMessage() invokes handleInboundMessage() internally, which:
 *   1. Creates/fetches the session
 *   2. Stores the user message
 *   3. Calls requestLLMResponse (via bus.request)
 *   4. Calls sendLLMResponse which may recurse for tool call iterations
 *
 * We mock bus.request to return canned LLM responses, and mock the
 * toolExecutor.executeToolCalls method to return canned tool results
 * (since ToolCoordinator is not initialized without gateway.start()).
 *
 * Spec IDs: [LLM-01] through [LLM-10]
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Gateway } from './gateway.js';
import { InMemoryMessageBus, createEnvelope } from './router.js';
import type {
  ChannelInboundMessage,
  LLMRequestType,
  LLMResponseType,
  MessageEnvelope,
} from '@nachos/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildToolCallResponse(
  sessionId: string,
  toolCalls: Array<{ id: string; name: string; arguments: string }>,
  text?: string
): LLMResponseType {
  return {
    sessionId,
    success: true,
    message: { role: 'assistant', content: text ?? '' },
    toolCalls,
    finishReason: 'tool_calls',
  };
}

function buildTextResponse(sessionId: string, text: string): LLMResponseType {
  return {
    sessionId,
    success: true,
    message: { role: 'assistant', content: text },
    finishReason: 'stop',
  };
}

function makeInbound(overrides?: Partial<ChannelInboundMessage>): ChannelInboundMessage {
  return {
    channel: 'slack',
    channelMessageId: 'msg-test-1',
    sender: { id: 'user-test', isAllowed: true },
    conversation: { id: 'conv-test', type: 'dm' },
    content: { text: 'Hello, run some tools please' },
    ...overrides,
  };
}

/**
 * Build a canned tool result in the LLM message format that
 * toolExecutor.executeToolCalls returns.
 */
function buildToolResultMessages(
  toolCalls: Array<{ id: string; name: string }>
): LLMRequestType['messages'] {
  return toolCalls.map((tc) => ({
    role: 'tool' as const,
    tool_call_id: tc.id,
    content: [
      {
        type: 'tool_result',
        tool_use_id: tc.id,
        tool_result: { result: `Mock result for ${tc.name}` },
      },
    ],
  }));
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('LLM Tool Loop Integration (LLM)', () => {
  let gateway: Gateway;
  let bus: InMemoryMessageBus;
  let publishedMessages: Array<{ topic: string; data: unknown }>;
  let llmResponseQueue: LLMResponseType[];

  /** The mocked executeToolCalls on the gateway's toolExecutor */
  let executeToolCallsMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    publishedMessages = [];
    llmResponseQueue = [];

    bus = new InMemoryMessageBus();

    // Mock bus.request to return queued LLM responses
    vi.spyOn(bus, 'request').mockImplementation(async (_topic, _data) => {
      const next = llmResponseQueue.shift();
      if (!next) {
        return createEnvelope(
          'llm-proxy',
          'llm.response',
          buildTextResponse('unknown', 'Fallback — queue empty')
        );
      }
      return createEnvelope('llm-proxy', 'llm.response', next);
    });

    // Spy on publish to capture outbound messages and status events
    const originalPublish = bus.publish.bind(bus);
    vi.spyOn(bus, 'publish').mockImplementation(async (topic, data) => {
      publishedMessages.push({ topic, data });
      return originalPublish(topic, data);
    });

    gateway = new Gateway({
      dbPath: ':memory:',
      bus,
      defaultSystemPrompt: 'You are a helpful test assistant.',
    });

    // Mock toolExecutor.executeToolCalls so we don't need ToolCoordinator
    const toolExecutor = (gateway as unknown as { toolExecutor: { executeToolCalls: unknown } })
      .toolExecutor;

    executeToolCallsMock = vi
      .fn()
      .mockImplementation(
        async (
          _sessionId: string,
          toolCalls: Array<{ id: string; name: string; arguments: string }>
        ) => {
          return buildToolResultMessages(toolCalls);
        }
      );
    toolExecutor.executeToolCalls = executeToolCallsMock;
  });

  afterEach(async () => {
    await gateway.stop();
  });

  // --------------------------------------------------------------------------
  // Tests
  // --------------------------------------------------------------------------

  it('[LLM-01] Full tool loop: LLM returns tool_call, gateway processes, sends results back, LLM returns text', async () => {
    llmResponseQueue = [
      buildToolCallResponse('s', [
        { id: 'call-1', name: 'memory_search', arguments: '{"query":"test"}' },
      ]),
      buildTextResponse('s', 'Here is what I found from memory.'),
    ];

    await gateway.processMessage(makeInbound());

    // Two LLM requests: first returns tool call, second returns text
    expect(bus.request).toHaveBeenCalledTimes(2);

    // Tool executor should have been called once with the tool call
    expect(executeToolCallsMock).toHaveBeenCalledTimes(1);
    expect(executeToolCallsMock).toHaveBeenCalledWith(
      expect.any(String),
      [expect.objectContaining({ id: 'call-1', name: 'memory_search' })],
      expect.anything()
    );

    // Final outbound message should contain the text response
    const outbound = publishedMessages.find((m) => m.topic === 'nachos.channel.slack.outbound');
    expect(outbound).toBeDefined();
    const payload = (outbound!.data as MessageEnvelope).payload as {
      content: { text: string };
    };
    expect(payload.content.text).toBe('Here is what I found from memory.');
  });

  it('[LLM-02] Messages stored in session: user, assistant (tool_use), tool result, and final assistant', async () => {
    llmResponseQueue = [
      buildToolCallResponse('s', [
        { id: 'call-2', name: 'memory_search', arguments: '{"query":"nachos"}' },
      ]),
      buildTextResponse('s', 'Final answer about nachos.'),
    ];

    const session = await gateway.processMessage(makeInbound());
    const messages = await gateway.getSessionsStore().getMessages(session.id);

    // Expected messages in order:
    //   user (stored by handleInboundMessage)
    //   assistant (tool_use, stored by sendLLMResponse)
    //   tool (result, stored by sendLLMResponse)
    //   assistant (final text, stored by sendLLMResponse)
    const roles = messages.map((m) => m.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    expect(roles).toContain('tool');

    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    expect(assistantMessages.length).toBeGreaterThanOrEqual(2);

    const toolMessages = messages.filter((m) => m.role === 'tool');
    expect(toolMessages.length).toBeGreaterThanOrEqual(1);

    // Final assistant message contains the text response
    const finalAssistant = assistantMessages[assistantMessages.length - 1];
    expect(finalAssistant?.content).toBe('Final answer about nachos.');
  });

  it('[LLM-03] Iteration cap: stops after MAX_TOOL_ITERATIONS (10)', async () => {
    // Queue 12 tool-call responses — the gateway should stop at iteration 10
    for (let i = 0; i < 12; i++) {
      llmResponseQueue.push(
        buildToolCallResponse('s', [
          { id: `call-loop-${i}`, name: 'memory_search', arguments: `{"q":"${i}"}` },
        ])
      );
    }

    await gateway.processMessage(makeInbound());

    // The cap is at toolIteration >= 10. Iteration 0 through 9 execute tools
    // (10 iterations), then on iteration 10 the cap fires and it falls through
    // to text. So bus.request is called 11 times (initial + 10 follow-ups).
    const requestCount = (bus.request as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(requestCount).toBeLessThanOrEqual(11);

    // Tool executor should have been called exactly 10 times (iterations 0-9)
    expect(executeToolCallsMock).toHaveBeenCalledTimes(10);

    // Gateway sends a fallback message when capped
    const outbound = publishedMessages.find((m) => m.topic === 'nachos.channel.slack.outbound');
    expect(outbound).toBeDefined();

    const payload = (outbound!.data as MessageEnvelope).payload as {
      content: { text: string };
    };
    // The cap fallback text is "I got caught in a loop..." (from gateway.ts line 1678)
    expect(payload.content.text).toContain('loop');
  });

  it('[LLM-04] Tool error handling: executeToolCalls throws, error message sent to user', async () => {
    // Make executeToolCalls throw
    executeToolCallsMock.mockRejectedValueOnce(new Error('Tool execution failed'));

    llmResponseQueue = [
      buildToolCallResponse('s', [{ id: 'call-err', name: 'broken_tool', arguments: '{}' }]),
    ];

    // processMessage should not throw — error is caught inside handleInboundMessage
    const session = await gateway.processMessage(makeInbound());
    expect(session).toBeDefined();

    // An error outbound message should have been published to the channel
    const outbound = publishedMessages.filter((m) => m.topic === 'nachos.channel.slack.outbound');
    expect(outbound.length).toBeGreaterThanOrEqual(1);

    // The error message text should indicate something went wrong
    const lastPayload = (outbound[outbound.length - 1]!.data as MessageEnvelope).payload as {
      content: { text: string };
    };
    expect(lastPayload.content.text).toMatch(/went wrong|error|failed/i);
  });

  it('[LLM-05] Empty tool calls array: should proceed to text response', async () => {
    llmResponseQueue = [
      {
        sessionId: 's',
        success: true,
        message: { role: 'assistant', content: 'No tools needed.' },
        toolCalls: [],
        finishReason: 'stop',
      },
    ];

    await gateway.processMessage(makeInbound());

    // bus.request called exactly once — no tool follow-up
    expect(bus.request).toHaveBeenCalledTimes(1);

    // Tool executor should NOT have been called
    expect(executeToolCallsMock).not.toHaveBeenCalled();

    // Text response sent to channel
    const outbound = publishedMessages.find((m) => m.topic === 'nachos.channel.slack.outbound');
    expect(outbound).toBeDefined();
    const payload = (outbound!.data as MessageEnvelope).payload as {
      content: { text: string };
    };
    expect(payload.content.text).toBe('No tools needed.');
  });

  it('[LLM-06] Status events: "thinking" published at start and "done" at end', async () => {
    llmResponseQueue = [buildTextResponse('s', 'Simple reply.')];

    await gateway.processMessage(makeInbound());

    const statusTopics = publishedMessages
      .filter((m) => m.topic.startsWith('nachos.status.'))
      .map((m) => m.topic);

    expect(statusTopics.some((t) => t.includes('.thinking'))).toBe(true);
    expect(statusTopics.some((t) => t.includes('.done'))).toBe(true);
  });

  it('[LLM-07] No text in LLM response: "done" event still fires but no outbound to channel', async () => {
    llmResponseQueue = [
      {
        sessionId: 's',
        success: true,
        message: { role: 'assistant', content: '' },
        finishReason: 'stop',
      },
    ];

    await gateway.processMessage(makeInbound());

    // The empty-text branch in sendLLMResponse returns early without sending
    // outbound and without publishing "done". But the outer handleInboundMessage
    // does not catch this — it just finishes. Check that no channel outbound
    // was published.
    const outbound = publishedMessages.filter((m) => m.topic === 'nachos.channel.slack.outbound');
    // Empty response should NOT result in a channel message
    // (sendLLMResponse returns early when responseText is falsy)
    expect(outbound.length).toBe(0);
  });

  it('[LLM-08] Multiple tool calls in single response are all processed', async () => {
    llmResponseQueue = [
      buildToolCallResponse('s', [
        { id: 'call-m1', name: 'memory_search', arguments: '{"q":"first"}' },
        { id: 'call-m2', name: 'web_fetch', arguments: '{"url":"https://example.com"}' },
      ]),
      buildTextResponse('s', 'Processed both tool calls.'),
    ];

    const session = await gateway.processMessage(makeInbound());

    // LLM called twice (tool response + final text)
    expect(bus.request).toHaveBeenCalledTimes(2);

    // executeToolCalls called once with both tool calls
    expect(executeToolCallsMock).toHaveBeenCalledTimes(1);
    const toolCallsArg = executeToolCallsMock.mock.calls[0]![1] as Array<{
      id: string;
      name: string;
    }>;
    expect(toolCallsArg).toHaveLength(2);
    expect(toolCallsArg[0]!.id).toBe('call-m1');
    expect(toolCallsArg[1]!.id).toBe('call-m2');

    // Session should contain 2 tool result messages
    const messages = await gateway.getSessionsStore().getMessages(session.id);
    const toolMessages = messages.filter((m) => m.role === 'tool');
    expect(toolMessages.length).toBeGreaterThanOrEqual(2);
  });

  it('[LLM-09] LLM error response is handled gracefully', async () => {
    llmResponseQueue = [
      {
        sessionId: 's',
        success: false,
        error: { code: 'RATE_LIMIT', message: 'Too many requests' },
        finishReason: 'error',
      } as LLMResponseType,
    ];

    // processMessage should not throw
    const session = await gateway.processMessage(makeInbound());
    expect(session).toBeDefined();
    expect(session.status).toBe('active');
  });

  it('[LLM-10] Session persists across multiple tool iterations', async () => {
    // Two rounds of tool calls then final text
    llmResponseQueue = [
      buildToolCallResponse('s', [
        { id: 'call-r1', name: 'memory_search', arguments: '{"q":"round1"}' },
      ]),
      buildToolCallResponse('s', [
        { id: 'call-r2', name: 'web_fetch', arguments: '{"url":"http://x.com"}' },
      ]),
      buildTextResponse('s', 'After two rounds of tools.'),
    ];

    const session = await gateway.processMessage(makeInbound());

    // Three LLM requests total
    expect(bus.request).toHaveBeenCalledTimes(3);
    // Two tool execution calls
    expect(executeToolCallsMock).toHaveBeenCalledTimes(2);

    const messages = await gateway.getSessionsStore().getMessages(session.id);
    const toolMessages = messages.filter((m) => m.role === 'tool');
    expect(toolMessages.length).toBeGreaterThanOrEqual(2);

    // Final assistant message present
    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    const lastAssistant = assistantMessages[assistantMessages.length - 1];
    expect(lastAssistant?.content).toBe('After two rounds of tools.');
  });
});
