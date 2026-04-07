import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createDiscordStatusReactionController,
  resolveToolStatusEmoji,
  DISCORD_STATUS_EMOJIS,
} from './status-reactions.js';

/**
 * Mock Discord.js Client that provides channel.messages.fetch -> message
 * The controller calls client.channels.fetch(channelId) -> channel,
 * then channel.messages.fetch(messageId) -> message.
 */
function createMockClient(overrides?: {
  reactFn?: ReturnType<typeof vi.fn>;
  removeFn?: ReturnType<typeof vi.fn>;
  channelFetchFails?: boolean;
  messageFetchFails?: boolean;
}) {
  const removeFn = overrides?.removeFn ?? vi.fn().mockResolvedValue(undefined);
  const reactFn = overrides?.reactFn ?? vi.fn().mockResolvedValue(undefined);

  const reactionCache = new Map<string, { users: { remove: typeof removeFn } }>();

  // Whenever react is called, put an entry in the cache so the controller can
  // find it to remove later.
  reactFn.mockImplementation(async (emoji: string) => {
    reactionCache.set(emoji, { users: { remove: removeFn } });
  });

  const mockMessage = {
    react: reactFn,
    reactions: {
      cache: reactionCache,
    },
  };

  const mockChannel = {
    messages: {
      fetch: overrides?.messageFetchFails
        ? vi.fn().mockRejectedValue(new Error('Unknown Message'))
        : vi.fn().mockResolvedValue(mockMessage),
    },
  };

  const client = {
    channels: {
      fetch: overrides?.channelFetchFails
        ? vi.fn().mockResolvedValue(null)
        : vi.fn().mockResolvedValue(mockChannel),
    },
    user: { id: 'bot-user-123' },
  };

  return { client, mockChannel, mockMessage, reactFn, removeFn, reactionCache };
}

/**
 * Helper to flush the enqueue chain and all pending microtasks/timers.
 * The controller chains async work via Promise.then(), so we need multiple
 * rounds of flushing to ensure all enqueued work completes.
 */
async function flushAsyncQueue(): Promise<void> {
  // Flush microtasks multiple times to drain the enqueue chain
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('Status Reactions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('resolveToolStatusEmoji', () => {
    it('[SR-04] should return coding emoji for code-related tools', () => {
      expect(resolveToolStatusEmoji('exec')).toBe(DISCORD_STATUS_EMOJIS.CODING);
      expect(resolveToolStatusEmoji('bash')).toBe(DISCORD_STATUS_EMOJIS.CODING);
      expect(resolveToolStatusEmoji('read')).toBe(DISCORD_STATUS_EMOJIS.CODING);
      expect(resolveToolStatusEmoji('write')).toBe(DISCORD_STATUS_EMOJIS.CODING);
      expect(resolveToolStatusEmoji('edit')).toBe(DISCORD_STATUS_EMOJIS.CODING);
      expect(resolveToolStatusEmoji('session_status')).toBe(DISCORD_STATUS_EMOJIS.CODING);
      expect(resolveToolStatusEmoji('process')).toBe(DISCORD_STATUS_EMOJIS.CODING);
    });

    it('[SR-05] should return web emoji for web-related tools', () => {
      expect(resolveToolStatusEmoji('web_search')).toBe(DISCORD_STATUS_EMOJIS.WEB);
      expect(resolveToolStatusEmoji('web-search')).toBe(DISCORD_STATUS_EMOJIS.WEB);
      expect(resolveToolStatusEmoji('web_fetch')).toBe(DISCORD_STATUS_EMOJIS.WEB);
      expect(resolveToolStatusEmoji('web-fetch')).toBe(DISCORD_STATUS_EMOJIS.WEB);
      expect(resolveToolStatusEmoji('browser')).toBe(DISCORD_STATUS_EMOJIS.WEB);
    });

    it('[SR-06] should return generic wrench emoji for unknown tools', () => {
      expect(resolveToolStatusEmoji('my_custom_tool')).toBe(DISCORD_STATUS_EMOJIS.TOOL);
      expect(resolveToolStatusEmoji('calculator')).toBe(DISCORD_STATUS_EMOJIS.TOOL);
    });

    it('[SR-06] should return generic wrench emoji when no tool name provided', () => {
      expect(resolveToolStatusEmoji(undefined)).toBe(DISCORD_STATUS_EMOJIS.TOOL);
      expect(resolveToolStatusEmoji('')).toBe(DISCORD_STATUS_EMOJIS.TOOL);
    });
  });

  describe('createDiscordStatusReactionController', () => {
    it('[SR-01] should create a controller with setPhase, setTerminal, finish, and scheduleStallTimers', () => {
      const { client } = createMockClient();
      const controller = createDiscordStatusReactionController({
        enabled: true,
        channelId: 'chan-1',
        messageId: 'msg-1',
        client: client as never,
      });

      expect(controller).toBeDefined();
      expect(typeof controller.setPhase).toBe('function');
      expect(typeof controller.setTerminal).toBe('function');
      expect(typeof controller.finish).toBe('function');
      expect(typeof controller.scheduleStallTimers).toBe('function');
    });

    it('[SR-02] should apply brain emoji when setPhase is called with thinking emoji', async () => {
      const { client, reactFn } = createMockClient();
      const controller = createDiscordStatusReactionController({
        enabled: true,
        channelId: 'chan-1',
        messageId: 'msg-1',
        client: client as never,
      });

      await controller.setPhase(DISCORD_STATUS_EMOJIS.THINKING);

      // Debounced by 700ms -- advance past the debounce
      await vi.advanceTimersByTimeAsync(700);
      await flushAsyncQueue();

      expect(reactFn).toHaveBeenCalledWith(DISCORD_STATUS_EMOJIS.THINKING);
    });

    it('[SR-03] should apply coding emoji when setPhase is called with a coding tool emoji', async () => {
      const { client, reactFn } = createMockClient();
      const controller = createDiscordStatusReactionController({
        enabled: true,
        channelId: 'chan-1',
        messageId: 'msg-1',
        client: client as never,
      });

      const emoji = resolveToolStatusEmoji('exec');
      await controller.setPhase(emoji);

      await vi.advanceTimersByTimeAsync(700);
      await flushAsyncQueue();

      expect(reactFn).toHaveBeenCalledWith(DISCORD_STATUS_EMOJIS.CODING);
    });

    it('[SR-03] should apply web emoji when setPhase is called with a web tool emoji', async () => {
      const { client, reactFn } = createMockClient();
      const controller = createDiscordStatusReactionController({
        enabled: true,
        channelId: 'chan-1',
        messageId: 'msg-1',
        client: client as never,
      });

      const emoji = resolveToolStatusEmoji('web_fetch');
      await controller.setPhase(emoji);

      await vi.advanceTimersByTimeAsync(700);
      await flushAsyncQueue();

      expect(reactFn).toHaveBeenCalledWith(DISCORD_STATUS_EMOJIS.WEB);
    });

    it('[SR-07] should apply checkmark emoji on setTerminal done and schedule removal after hold', async () => {
      const { client, reactFn, removeFn } = createMockClient();
      const controller = createDiscordStatusReactionController({
        enabled: true,
        channelId: 'chan-1',
        messageId: 'msg-1',
        client: client as never,
      });

      // First apply a phase emoji so the controller has active state
      await controller.setPhase(DISCORD_STATUS_EMOJIS.THINKING);
      await vi.advanceTimersByTimeAsync(700);
      await flushAsyncQueue();

      expect(reactFn).toHaveBeenCalledWith(DISCORD_STATUS_EMOJIS.THINKING);
      reactFn.mockClear();

      // Now call setTerminal with DONE -- this enqueues applyEmoji which should
      // apply the terminal emoji, replacing the thinking emoji.
      await controller.setTerminal(DISCORD_STATUS_EMOJIS.DONE);
      await flushAsyncQueue();

      // The terminal emoji should have been applied
      expect(reactFn).toHaveBeenCalledWith(DISCORD_STATUS_EMOJIS.DONE);

      // The previous thinking emoji should have been removed
      expect(removeFn).toHaveBeenCalledWith('bot-user-123');
      removeFn.mockClear();

      // Advance past the DONE_HOLD_MS (1500ms) to trigger the removal setTimeout
      await vi.advanceTimersByTimeAsync(1500);
      await flushAsyncQueue();

      // The hold timer fires and removes the terminal emoji (DONE)
      expect(removeFn).toHaveBeenCalledWith('bot-user-123');
    });

    it('[SR-08] should apply X emoji on setTerminal error and schedule removal after hold', async () => {
      const { client, reactFn, removeFn } = createMockClient();
      const controller = createDiscordStatusReactionController({
        enabled: true,
        channelId: 'chan-1',
        messageId: 'msg-1',
        client: client as never,
      });

      // First apply a phase emoji
      await controller.setPhase(DISCORD_STATUS_EMOJIS.THINKING);
      await vi.advanceTimersByTimeAsync(700);
      await flushAsyncQueue();

      expect(reactFn).toHaveBeenCalledWith(DISCORD_STATUS_EMOJIS.THINKING);
      reactFn.mockClear();

      // Now call setTerminal with ERROR -- should apply the error emoji
      await controller.setTerminal(DISCORD_STATUS_EMOJIS.ERROR);
      await flushAsyncQueue();

      // The terminal emoji should have been applied
      expect(reactFn).toHaveBeenCalledWith(DISCORD_STATUS_EMOJIS.ERROR);

      // The previous thinking emoji should have been removed
      expect(removeFn).toHaveBeenCalledWith('bot-user-123');
      removeFn.mockClear();

      // Advance past ERROR_HOLD_MS (2500ms)
      await vi.advanceTimersByTimeAsync(2500);
      await flushAsyncQueue();

      // The hold timer fires and removes the terminal emoji (ERROR)
      expect(removeFn).toHaveBeenCalledWith('bot-user-123');
    });

    it('[SR-09] should debounce rapid setPhase calls so only the last emoji is applied', async () => {
      const { client, reactFn } = createMockClient();
      const controller = createDiscordStatusReactionController({
        enabled: true,
        channelId: 'chan-1',
        messageId: 'msg-1',
        client: client as never,
      });

      // Rapid synchronous calls -- each replaces the pending debounce timer
      await controller.setPhase(DISCORD_STATUS_EMOJIS.THINKING);
      await controller.setPhase(DISCORD_STATUS_EMOJIS.CODING);
      await controller.setPhase(DISCORD_STATUS_EMOJIS.WEB);

      // No reactions yet -- still within debounce window
      expect(reactFn).not.toHaveBeenCalled();

      // Advance past the 700ms debounce
      await vi.advanceTimersByTimeAsync(700);
      await flushAsyncQueue();

      // Only the last emoji should have been applied
      expect(reactFn).toHaveBeenCalledTimes(1);
      expect(reactFn).toHaveBeenCalledWith(DISCORD_STATUS_EMOJIS.WEB);
    });

    it('[SR-16] should remove active emoji and mark controller as finished on finish()', async () => {
      const { client, reactFn, removeFn } = createMockClient();
      const controller = createDiscordStatusReactionController({
        enabled: true,
        channelId: 'chan-1',
        messageId: 'msg-1',
        client: client as never,
      });

      // Apply an emoji first
      await controller.setPhase(DISCORD_STATUS_EMOJIS.THINKING);
      await vi.advanceTimersByTimeAsync(700);
      await flushAsyncQueue();

      expect(reactFn).toHaveBeenCalledWith(DISCORD_STATUS_EMOJIS.THINKING);

      // Now finish
      await controller.finish();
      await flushAsyncQueue();

      expect(removeFn).toHaveBeenCalledWith('bot-user-123');

      // Subsequent setPhase calls should be no-ops
      reactFn.mockClear();
      await controller.setPhase(DISCORD_STATUS_EMOJIS.CODING);
      await vi.advanceTimersByTimeAsync(700);
      await flushAsyncQueue();

      expect(reactFn).not.toHaveBeenCalled();
    });

    it('[SR-17] should handle missing channel gracefully and log warning', async () => {
      const { client, reactFn } = createMockClient({ channelFetchFails: true });
      const controller = createDiscordStatusReactionController({
        enabled: true,
        channelId: 'missing-chan',
        messageId: 'msg-1',
        client: client as never,
      });

      // Should not throw
      await controller.setPhase(DISCORD_STATUS_EMOJIS.THINKING);
      await vi.advanceTimersByTimeAsync(700);
      await flushAsyncQueue();

      // React should not have been called since channel fetch returned null
      expect(reactFn).not.toHaveBeenCalled();
    });

    it('[SR-01] should not apply emoji when enabled is false', async () => {
      const { client, reactFn } = createMockClient();
      const controller = createDiscordStatusReactionController({
        enabled: false,
        channelId: 'chan-1',
        messageId: 'msg-1',
        client: client as never,
      });

      await controller.setPhase(DISCORD_STATUS_EMOJIS.THINKING);
      await vi.advanceTimersByTimeAsync(700);
      await flushAsyncQueue();

      expect(reactFn).not.toHaveBeenCalled();
    });
  });
});
