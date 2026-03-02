/**
 * Discord Status Reactions Controller
 *
 * Provides real-time status feedback via emoji reactions during bot operations.
 * Ported from OpenClaw's emoji status system.
 */

import type { Client } from 'discord.js';
import { createLogger } from '@nachos/types';

const logger = createLogger('discord-status');

// Status emojis
const STATUS_THINKING = '🧠';
const STATUS_TOOL = '🛠️';
const STATUS_CODING = '💻';
const STATUS_WEB = '🌐';
const STATUS_DONE = '✅';
const STATUS_ERROR = '❌';
const STATUS_STALL_SOFT = '⏳';
const STATUS_STALL_HARD = '⚠️';

// Timing constants
const DEBOUNCE_MS = 700;
const DONE_HOLD_MS = 1500;
const ERROR_HOLD_MS = 2500;
const STALL_SOFT_MS = 10_000;
const STALL_HARD_MS = 30_000;

// Tool categorization for specialized emojis
const CODING_TOOLS = ['exec', 'process', 'read', 'write', 'edit', 'session_status', 'bash'];
const WEB_TOOLS = ['web_search', 'web-search', 'web_fetch', 'web-fetch', 'browser'];

interface StatusReactionConfig {
  enabled: boolean;
  channelId: string;
  messageId: string;
  client: Client;
}

export interface StatusReactionController {
  /**
   * Set phase emoji (thinking, tool use, etc.)
   * Debounced by default to avoid reaction spam
   */
  setPhase(emoji: string): Promise<void>;

  /**
   * Set terminal emoji (done, error)
   * Holds for specified duration, then removes
   */
  setTerminal(emoji: string, holdMs?: number): Promise<void>;

  /**
   * Complete the status controller
   * Removes all reactions
   */
  finish(): Promise<void>;

  /**
   * Restart stall timers
   */
  scheduleStallTimers(): void;
}

/**
 * Determine appropriate emoji for a tool name
 */
export function resolveToolStatusEmoji(toolName?: string): string {
  const normalized = toolName?.trim().toLowerCase() ?? '';
  if (!normalized) {
    return STATUS_TOOL;
  }
  if (WEB_TOOLS.some((token) => normalized.includes(token))) {
    return STATUS_WEB;
  }
  if (CODING_TOOLS.some((token) => normalized.includes(token))) {
    return STATUS_CODING;
  }
  return STATUS_TOOL;
}

/**
 * Create a status reaction controller for a Discord message
 */
export function createDiscordStatusReactionController(
  config: StatusReactionConfig
): StatusReactionController {
  let activeEmoji: string | null = null;
  let chain: Promise<void> = Promise.resolve();
  let pendingEmoji: string | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let finished = false;
  let softStallTimer: ReturnType<typeof setTimeout> | null = null;
  let hardStallTimer: ReturnType<typeof setTimeout> | null = null;

  const enqueue = (work: () => Promise<void>) => {
    chain = chain.then(work).catch((err) => {
      logger.warn(
        { err, channelId: config.channelId, messageId: config.messageId },
        'Status reaction failed'
      );
    });
    return chain;
  };

  const clearStallTimers = () => {
    if (softStallTimer) {
      clearTimeout(softStallTimer);
      softStallTimer = null;
    }
    if (hardStallTimer) {
      clearTimeout(hardStallTimer);
      hardStallTimer = null;
    }
  };

  const clearPendingDebounce = () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    pendingEmoji = null;
  };

  const applyEmoji = (emoji: string) =>
    enqueue(async () => {
      if (!config.enabled || !emoji || activeEmoji === emoji || finished) {
        return;
      }

      const previousEmoji = activeEmoji;

      try {
        const channel = await config.client.channels.fetch(config.channelId);
        if (!channel || !('messages' in channel)) {
          logger.warn({ channelId: config.channelId }, 'Channel not found or not a text channel');
          return;
        }

        const message = await channel.messages.fetch(config.messageId);
        await message.react(emoji);
        activeEmoji = emoji;

        // Remove previous emoji if different
        if (previousEmoji && previousEmoji !== emoji) {
          const botReactions = message.reactions.cache.get(previousEmoji);
          if (botReactions) {
            await botReactions.users.remove(config.client.user?.id);
          }
        }
      } catch (err) {
        logger.warn(
          { err, emoji, channelId: config.channelId, messageId: config.messageId },
          'Failed to apply emoji reaction'
        );
      }
    });

  const requestEmoji = (emoji: string, options?: { immediate?: boolean }) => {
    if (!config.enabled || !emoji || finished) {
      return Promise.resolve();
    }

    if (options?.immediate) {
      clearPendingDebounce();
      return applyEmoji(emoji);
    }

    // Debounce emoji changes
    pendingEmoji = emoji;
    if (pendingTimer) {
      clearTimeout(pendingTimer);
    }

    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      const emojiToApply = pendingEmoji;
      pendingEmoji = null;
      if (!emojiToApply || emojiToApply === activeEmoji) {
        return;
      }
      void applyEmoji(emojiToApply);
    }, DEBOUNCE_MS);

    return Promise.resolve();
  };

  const scheduleStallTimers = () => {
    if (!config.enabled || finished) {
      return;
    }

    clearStallTimers();

    softStallTimer = setTimeout(() => {
      if (finished) {
        return;
      }
      void requestEmoji(STATUS_STALL_SOFT, { immediate: true });
    }, STALL_SOFT_MS);

    hardStallTimer = setTimeout(() => {
      if (finished) {
        return;
      }
      void requestEmoji(STATUS_STALL_HARD, { immediate: true });
    }, STALL_HARD_MS);
  };

  const setPhase = (emoji: string) => {
    if (!config.enabled || finished) {
      return Promise.resolve();
    }
    scheduleStallTimers();
    return requestEmoji(emoji);
  };

  const setTerminal = async (emoji: string, holdMs?: number) => {
    if (!config.enabled || finished) {
      return;
    }

    finished = true;
    clearStallTimers();
    clearPendingDebounce();

    await applyEmoji(emoji);

    const hold = holdMs ?? (emoji === STATUS_ERROR ? ERROR_HOLD_MS : DONE_HOLD_MS);

    setTimeout(async () => {
      await enqueue(async () => {
        if (!activeEmoji) {
          return;
        }

        try {
          const channel = await config.client.channels.fetch(config.channelId);
          if (!channel || !('messages' in channel)) {
            return;
          }

          const message = await channel.messages.fetch(config.messageId);
          const botReactions = message.reactions.cache.get(activeEmoji);
          if (botReactions) {
            await botReactions.users.remove(config.client.user?.id);
          }
          activeEmoji = null;
        } catch (err) {
          logger.warn({ err }, 'Failed to remove terminal emoji');
        }
      });
    }, hold);
  };

  const finish = async () => {
    if (finished) {
      return;
    }

    finished = true;
    clearStallTimers();
    clearPendingDebounce();

    await enqueue(async () => {
      if (!activeEmoji) {
        return;
      }

      try {
        const channel = await config.client.channels.fetch(config.channelId);
        if (!channel || !('messages' in channel)) {
          return;
        }

        const message = await channel.messages.fetch(config.messageId);
        const botReactions = message.reactions.cache.get(activeEmoji);
        if (botReactions) {
          await botReactions.users.remove(config.client.user?.id);
        }
        activeEmoji = null;
      } catch (err) {
        logger.warn({ err }, 'Failed to remove emoji on finish');
      }
    });
  };

  return {
    setPhase,
    setTerminal,
    finish,
    scheduleStallTimers,
  };
}

// Export emoji constants for use by other modules
export const DISCORD_STATUS_EMOJIS = {
  THINKING: STATUS_THINKING,
  TOOL: STATUS_TOOL,
  CODING: STATUS_CODING,
  WEB: STATUS_WEB,
  DONE: STATUS_DONE,
  ERROR: STATUS_ERROR,
  STALL_SOFT: STATUS_STALL_SOFT,
  STALL_HARD: STATUS_STALL_HARD,
} as const;
