import { describe, it, expect, vi, afterEach } from 'vitest';
import { DiscordChannelAdapter } from './index.js';
import { applyEnvBridge } from './main.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type ChannelAdapterConfig = {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  bus: {
    publish: (topic: string, payload: unknown) => void | Promise<void>;
    subscribe: (topic: string, handler: (payload: unknown) => void) => Promise<unknown>;
  };
  securityMode: 'strict' | 'standard' | 'permissive';
  dmPolicy?: {
    userAllowlist: string[];
    pairing?: boolean;
  };
};

/** Helper: call private handleMessage on an adapter instance */
function callHandleMessage(adapter: DiscordChannelAdapter, message: unknown): Promise<void> {
  return (adapter as unknown as { handleMessage: (input: unknown) => Promise<void> }).handleMessage(
    message
  );
}

/** Helper: call private handleCommandInteraction on an adapter instance */
function callHandleCommandInteraction(
  adapter: DiscordChannelAdapter,
  interaction: unknown
): Promise<void> {
  return (
    adapter as unknown as {
      handleCommandInteraction: (input: unknown) => Promise<void>;
    }
  ).handleCommandInteraction(interaction);
}

/** Helper: create a mock Discord ChatInputCommandInteraction */
function createMockInteraction(overrides?: {
  userId?: string;
  guildId?: string | null;
  channelId?: string;
  subcommand?: string | null;
  subcommandGroup?: string | null;
  options?: Record<string, string>;
  permissions?: Set<bigint>;
}) {
  const userId = overrides?.userId ?? 'user-1';
  const guildId = overrides?.guildId ?? 'guild-1';
  const channelId = overrides?.channelId ?? 'chan-1';
  const sub = overrides?.subcommand ?? null;
  const group = overrides?.subcommandGroup ?? null;
  const optionsMap = overrides?.options ?? {};
  const permissions = overrides?.permissions ?? new Set<bigint>();

  return {
    commandName: 'nachos',
    user: { id: userId },
    guildId,
    channelId,
    memberPermissions: {
      has: (flag: bigint) => permissions.has(flag),
    },
    options: {
      getSubcommand: (_required?: boolean) => sub,
      getSubcommandGroup: (_required?: boolean) => group,
      getString: (name: string, _required?: boolean) => optionsMap[name] ?? null,
    },
    reply: vi.fn().mockResolvedValue(undefined),
    isChatInputCommand: () => true,
  };
}

describe('DiscordChannelAdapter', () => {
  afterEach(() => {
    delete process.env.RUNTIME_STATE_DIR;
    delete process.env.NACHOS_PAIRING_TOKEN;
  });

  it('throws when token is missing on start', async () => {
    const adapter = new DiscordChannelAdapter();

    const config: ChannelAdapterConfig = {
      config: {},
      secrets: {},
      bus: {
        publish: async () => {},
        subscribe: async () => {},
      },
      securityMode: 'standard',
    };

    await adapter.initialize(config as unknown as ChannelAdapterConfig);

    await expect(adapter.start()).rejects.toThrow('Discord token is required');
  });

  it('publishes inbound DM messages when allowlisted', async () => {
    const adapter = new DiscordChannelAdapter();
    const publish = vi.fn();

    const config: ChannelAdapterConfig = {
      config: { dm: { user_allowlist: ['user-1'] } },
      secrets: {},
      bus: {
        publish,
        subscribe: async () => {},
      },
      securityMode: 'standard',
    };

    (adapter as unknown as { config?: ChannelAdapterConfig }).config = config;

    const message = {
      id: 'msg-1',
      channelId: 'dm-1',
      content: 'Hello',
      guildId: null,
      author: { id: 'user-1', bot: false },
    } as unknown;

    await (
      adapter as unknown as { handleMessage: (input: unknown) => Promise<void> }
    ).handleMessage(message);

    expect(publish).toHaveBeenCalledWith(
      'nachos.channel.discord.inbound',
      expect.objectContaining({
        sender: expect.objectContaining({ id: 'user-1' }),
        conversation: expect.objectContaining({ id: 'dm-1', type: 'dm' }),
        content: expect.objectContaining({ text: 'Hello' }),
      })
    );
  });

  it('forwards inbound Discord attachments in the published message', async () => {
    const adapter = new DiscordChannelAdapter();
    const publish = vi.fn();

    const config: ChannelAdapterConfig = {
      config: { dm: { user_allowlist: ['user-1'] } },
      secrets: {},
      bus: {
        publish,
        subscribe: async () => {},
      },
      securityMode: 'standard',
    };

    (adapter as unknown as { config?: ChannelAdapterConfig }).config = config;

    // Create a mock Discord attachments Collection (Map-like)
    const mockAttachments = new Map([
      [
        'att-1',
        {
          url: 'https://cdn.discordapp.com/attachments/123/456/image.png',
          name: 'image.png',
          contentType: 'image/png',
          size: 12345,
        },
      ],
      [
        'att-2',
        {
          url: 'https://cdn.discordapp.com/attachments/123/456/doc.pdf',
          name: 'doc.pdf',
          contentType: 'application/pdf',
          size: 67890,
        },
      ],
    ]);

    const message = {
      id: 'msg-attach',
      channelId: 'dm-1',
      content: 'Check these files',
      guildId: null,
      author: { id: 'user-1', bot: false },
      attachments: mockAttachments,
    } as unknown;

    await callHandleMessage(adapter, message);

    expect(publish).toHaveBeenCalledWith(
      'nachos.channel.discord.inbound',
      expect.objectContaining({
        content: expect.objectContaining({
          text: 'Check these files',
          attachments: [
            {
              type: 'image',
              url: 'https://cdn.discordapp.com/attachments/123/456/image.png',
              name: 'image.png',
              mimeType: 'image/png',
              size: 12345,
            },
            {
              type: 'file',
              url: 'https://cdn.discordapp.com/attachments/123/456/doc.pdf',
              name: 'doc.pdf',
              mimeType: 'application/pdf',
              size: 67890,
            },
          ],
        }),
      })
    );
  });

  it('omits attachments field when Discord message has no attachments', async () => {
    const adapter = new DiscordChannelAdapter();
    const publish = vi.fn();

    const config: ChannelAdapterConfig = {
      config: { dm: { user_allowlist: ['user-1'] } },
      secrets: {},
      bus: {
        publish,
        subscribe: async () => {},
      },
      securityMode: 'standard',
    };

    (adapter as unknown as { config?: ChannelAdapterConfig }).config = config;

    const message = {
      id: 'msg-no-attach',
      channelId: 'dm-1',
      content: 'No files here',
      guildId: null,
      author: { id: 'user-1', bot: false },
      attachments: new Map(),
    } as unknown;

    await callHandleMessage(adapter, message);

    const publishedPayload = publish.mock.calls[0]?.[1] as Record<string, unknown>;
    const content = publishedPayload?.content as Record<string, unknown>;
    expect(content.text).toBe('No files here');
    expect(content.attachments).toBeUndefined();
  });

  it('sends outbound messages to Discord channel', async () => {
    const adapter = new DiscordChannelAdapter();
    const send = vi.fn().mockResolvedValue({ id: 'msg-2' });
    const fetch = vi.fn().mockResolvedValue({ send });

    (adapter as unknown as { client?: unknown }).client = {
      channels: { fetch },
    } as unknown;

    const result = await adapter.sendMessage({
      channel: 'discord',
      conversationId: 'channel-1',
      content: { text: 'Hi' },
    });

    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledWith('channel-1');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: 'Hi' }));
  });

  it('publishes inbound channel messages when mention-gated and allowlisted', async () => {
    const adapter = new DiscordChannelAdapter();
    const publish = vi.fn();

    await adapter.initialize({
      config: {
        servers: [
          {
            id: 'guild-1',
            channel_ids: ['chan-1'],
            user_allowlist: ['user-1'],
            mention_gating: true,
          },
        ],
      },
      secrets: {},
      bus: {
        publish,
        subscribe: async () => {},
      },
      securityMode: 'standard',
    } as ChannelAdapterConfig);

    (adapter as unknown as { botUserId?: string }).botUserId = 'bot-1';

    await (
      adapter as unknown as { handleMessage: (input: unknown) => Promise<void> }
    ).handleMessage({
      id: 'msg-10',
      channelId: 'chan-1',
      content: 'Hello <@!bot-1>',
      guildId: 'guild-1',
      author: { id: 'user-1', bot: false },
    });

    expect(publish).toHaveBeenCalledWith(
      'nachos.channel.discord.inbound',
      expect.objectContaining({
        conversation: expect.objectContaining({ id: 'chan-1', type: 'channel' }),
      })
    );
  });

  it('drops messages from channels not in channel allowlist', async () => {
    const adapter = new DiscordChannelAdapter();
    const publish = vi.fn();

    await adapter.initialize({
      config: {
        servers: [
          {
            id: 'guild-1',
            channel_ids: ['chan-tinkering'],
            user_allowlist: ['user-1'],
            mention_gating: false,
          },
        ],
      },
      secrets: {},
      bus: {
        publish,
        subscribe: async () => {},
      },
      securityMode: 'standard',
    } as ChannelAdapterConfig);

    // Message from an allowed user but from a non-allowlisted channel
    await callHandleMessage(adapter, {
      id: 'msg-wrong-chan',
      channelId: 'chan-general',
      content: 'Hello from wrong channel',
      guildId: 'guild-1',
      author: { id: 'user-1', bot: false },
    });

    expect(publish).not.toHaveBeenCalled();
  });

  it('drops messages from non-allowlisted users in guild channels', async () => {
    const adapter = new DiscordChannelAdapter();
    const publish = vi.fn();

    await adapter.initialize({
      config: {
        servers: [
          {
            id: 'guild-1',
            channel_ids: ['chan-1'],
            user_allowlist: ['user-allowed'],
            mention_gating: false,
          },
        ],
      },
      secrets: {},
      bus: {
        publish,
        subscribe: async () => {},
      },
      securityMode: 'standard',
    } as ChannelAdapterConfig);

    await callHandleMessage(adapter, {
      id: 'msg-unallowlisted',
      channelId: 'chan-1',
      content: 'I am not allowlisted',
      guildId: 'guild-1',
      author: { id: 'user-not-in-list', bot: false },
    });

    expect(publish).not.toHaveBeenCalled();
  });

  it('drops guild messages when mention-only mode is on and no mention present', async () => {
    const adapter = new DiscordChannelAdapter();
    const publish = vi.fn();

    await adapter.initialize({
      config: {
        servers: [
          {
            id: 'guild-1',
            channel_ids: ['chan-1'],
            user_allowlist: ['user-1'],
            mention_gating: true,
          },
        ],
      },
      secrets: {},
      bus: {
        publish,
        subscribe: async () => {},
      },
      securityMode: 'standard',
    } as ChannelAdapterConfig);

    (adapter as unknown as { botUserId?: string }).botUserId = 'bot-1';

    // Message without a mention — should be dropped
    await callHandleMessage(adapter, {
      id: 'msg-no-mention',
      channelId: 'chan-1',
      content: 'just chatting, no mention here',
      guildId: 'guild-1',
      author: { id: 'user-1', bot: false },
    });

    expect(publish).not.toHaveBeenCalled();
  });

  it('sends outbound attachments to Discord channel', async () => {
    const adapter = new DiscordChannelAdapter();
    const send = vi.fn().mockResolvedValue({ id: 'msg-3' });
    const fetch = vi.fn().mockResolvedValue({ send });

    (adapter as unknown as { client?: unknown }).client = {
      channels: { fetch },
    } as unknown;

    const result = await adapter.sendMessage({
      channel: 'discord',
      conversationId: 'channel-1',
      content: {
        text: 'File',
        attachments: [
          {
            type: 'file',
            data: Buffer.from('hello').toString('base64'),
            name: 'hello.txt',
          },
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        files: expect.any(Array),
      })
    );
  });

  it('requires pairing token before allowing DMs when pairing enabled', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nachos-pairing-'));
    process.env.RUNTIME_STATE_DIR = tempDir;
    process.env.NACHOS_PAIRING_TOKEN = 'secret';

    const adapter = new DiscordChannelAdapter();
    const publish = vi.fn();

    await adapter.initialize({
      config: { dm: { user_allowlist: [], pairing: true } },
      secrets: {},
      bus: {
        publish,
        subscribe: async () => {},
      },
      securityMode: 'standard',
    } as ChannelAdapterConfig);

    vi.spyOn(adapter, 'sendMessage').mockResolvedValue({ success: true });

    const handleMessage = (
      adapter as unknown as { handleMessage: (input: unknown) => Promise<void> }
    ).handleMessage.bind(adapter);

    await handleMessage({
      id: 'm1',
      channelId: 'dm-1',
      content: 'pair wrong',
      guildId: null,
      author: { id: 'user-1', bot: false },
    });

    expect(publish).not.toHaveBeenCalled();

    await handleMessage({
      id: 'm2',
      channelId: 'dm-1',
      content: 'pair secret',
      guildId: null,
      author: { id: 'user-1', bot: false },
    });

    await handleMessage({
      id: 'm3',
      channelId: 'dm-1',
      content: 'Hello after pairing',
      guildId: null,
      author: { id: 'user-1', bot: false },
    });

    expect(publish).toHaveBeenCalledWith(
      'nachos.channel.discord.inbound',
      expect.objectContaining({
        sender: expect.objectContaining({ id: 'user-1' }),
        content: expect.objectContaining({ text: 'Hello after pairing' }),
      })
    );
  });

  describe('Typing Indicators', () => {
    it('starts typing interval on thinking status event', async () => {
      const adapter = new DiscordChannelAdapter();
      const sendTyping = vi.fn().mockResolvedValue(undefined);
      const fetch = vi.fn().mockResolvedValue({ sendTyping });

      vi.useFakeTimers();

      await adapter.initialize({
        config: { typing_indicators: true },
        secrets: {},
        bus: {
          publish: async () => {},
          subscribe: async () => {},
        },
        securityMode: 'standard',
      } as ChannelAdapterConfig);

      (adapter as unknown as { client?: unknown }).client = {
        channels: { fetch },
      } as unknown;

      // Simulate thinking status event
      await (
        adapter as unknown as { handleStatusEvent: (event: unknown) => Promise<void> }
      ).handleStatusEvent({
        sessionId: 'session-1',
        status: 'thinking',
        channelId: 'channel-1',
      });

      // Should send typing immediately
      expect(sendTyping).toHaveBeenCalledTimes(1);

      // Advance time by 8 seconds
      vi.advanceTimersByTime(8000);
      await Promise.resolve(); // Let promises settle

      // Should send typing again
      expect(sendTyping).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('stops typing interval on done status event', async () => {
      const adapter = new DiscordChannelAdapter();
      const sendTyping = vi.fn().mockResolvedValue(undefined);
      const fetch = vi.fn().mockResolvedValue({ sendTyping });

      vi.useFakeTimers();

      await adapter.initialize({
        config: { typing_indicators: true },
        secrets: {},
        bus: {
          publish: async () => {},
          subscribe: async () => {},
        },
        securityMode: 'standard',
      } as ChannelAdapterConfig);

      (adapter as unknown as { client?: unknown }).client = {
        channels: { fetch },
      } as unknown;

      // Start typing
      await (
        adapter as unknown as { handleStatusEvent: (event: unknown) => Promise<void> }
      ).handleStatusEvent({
        sessionId: 'session-1',
        status: 'thinking',
        channelId: 'channel-1',
      });

      expect(sendTyping).toHaveBeenCalledTimes(1);

      // Stop typing
      await (
        adapter as unknown as { handleStatusEvent: (event: unknown) => Promise<void> }
      ).handleStatusEvent({
        sessionId: 'session-1',
        status: 'done',
        channelId: 'channel-1',
      });

      // Advance time - should not send typing again
      vi.advanceTimersByTime(8000);
      await Promise.resolve();

      expect(sendTyping).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('[TI-04] refreshes typing indicator on tool status event', async () => {
      const adapter = new DiscordChannelAdapter();
      const sendTyping = vi.fn().mockResolvedValue(undefined);
      const fetch = vi.fn().mockResolvedValue({ sendTyping });

      vi.useFakeTimers();

      await adapter.initialize({
        config: { typing_indicators: true },
        secrets: {},
        bus: {
          publish: async () => {},
          subscribe: async () => {},
        },
        securityMode: 'standard',
      } as ChannelAdapterConfig);

      (adapter as unknown as { client?: unknown }).client = {
        channels: { fetch },
      } as unknown;

      const handleStatusEvent = (
        adapter as unknown as { handleStatusEvent: (event: unknown) => Promise<void> }
      ).handleStatusEvent.bind(adapter);

      // Simulate tool status event (no prior thinking event)
      await handleStatusEvent({
        sessionId: 'session-1',
        status: 'tool',
        channelId: 'channel-1',
        toolName: 'web-fetch',
      });

      // Should send typing immediately on tool event
      expect(sendTyping).toHaveBeenCalledTimes(1);

      // Advance time by 8 seconds — interval should continue during tool execution
      vi.advanceTimersByTime(8000);
      await Promise.resolve();

      expect(sendTyping).toHaveBeenCalledTimes(2);

      // Stop typing on done
      await handleStatusEvent({
        sessionId: 'session-1',
        status: 'done',
        channelId: 'channel-1',
      });

      // Advance time — should not send typing anymore
      vi.advanceTimersByTime(8000);
      await Promise.resolve();

      expect(sendTyping).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('cleans up typing intervals on shutdown', async () => {
      const adapter = new DiscordChannelAdapter();
      const sendTyping = vi.fn().mockResolvedValue(undefined);
      const fetch = vi.fn().mockResolvedValue({ sendTyping });
      const destroy = vi.fn().mockResolvedValue(undefined);

      vi.useFakeTimers();

      await adapter.initialize({
        config: { typing_indicators: true },
        secrets: {},
        bus: {
          publish: async () => {},
          subscribe: async () => {},
        },
        securityMode: 'standard',
      } as ChannelAdapterConfig);

      (adapter as unknown as { client?: unknown }).client = {
        channels: { fetch },
        destroy,
      } as unknown;

      // Start typing for multiple channels
      await (
        adapter as unknown as { handleStatusEvent: (event: unknown) => Promise<void> }
      ).handleStatusEvent({
        sessionId: 'session-1',
        status: 'thinking',
        channelId: 'channel-1',
      });

      await (
        adapter as unknown as { handleStatusEvent: (event: unknown) => Promise<void> }
      ).handleStatusEvent({
        sessionId: 'session-2',
        status: 'thinking',
        channelId: 'channel-2',
      });

      // Stop adapter
      await adapter.stop();

      // Advance time - should not send typing anymore
      vi.advanceTimersByTime(8000);
      await Promise.resolve();

      // Should only have been called once per channel initially
      expect(sendTyping).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe('Bot Filtering', () => {
    it('[BF-01] should drop bot messages by default', async () => {
      const adapter = new DiscordChannelAdapter();
      const publish = vi.fn();

      await adapter.initialize({
        config: {
          servers: [
            {
              id: 'guild-1',
              channel_ids: ['chan-1'],
              user_allowlist: [],
              mention_gating: false,
            },
          ],
        },
        secrets: {},
        bus: { publish, subscribe: async () => {} },
        securityMode: 'standard',
      } as ChannelAdapterConfig);

      await callHandleMessage(adapter, {
        id: 'msg-bot-1',
        channelId: 'chan-1',
        content: 'I am a bot',
        guildId: 'guild-1',
        author: { id: 'bot-999', bot: true },
      });

      expect(publish).not.toHaveBeenCalled();
    });

    it('[BF-04] should always drop own messages to prevent self-reply loops', async () => {
      const adapter = new DiscordChannelAdapter();
      const publish = vi.fn();

      await adapter.initialize({
        config: {
          allow_bots: true,
          servers: [
            {
              id: 'guild-1',
              channel_ids: ['chan-1'],
              user_allowlist: [],
              mention_gating: false,
            },
          ],
        },
        secrets: {},
        bus: { publish, subscribe: async () => {} },
        securityMode: 'standard',
      } as ChannelAdapterConfig);

      // Set botUserId to match message author
      (adapter as unknown as { botUserId?: string }).botUserId = 'self-bot-id';

      await callHandleMessage(adapter, {
        id: 'msg-self',
        channelId: 'chan-1',
        content: 'My own message',
        guildId: 'guild-1',
        author: { id: 'self-bot-id', bot: true },
      });

      expect(publish).not.toHaveBeenCalled();
    });

    it('[BF-02] should allow bot messages when allow_bots is true', async () => {
      const adapter = new DiscordChannelAdapter();
      const publish = vi.fn();

      await adapter.initialize({
        config: {
          allow_bots: true,
          servers: [
            {
              id: 'guild-1',
              channel_ids: ['chan-1'],
              user_allowlist: ['other-bot-123'],
              mention_gating: false,
            },
          ],
        },
        secrets: {},
        bus: { publish, subscribe: async () => {} },
        securityMode: 'standard',
      } as ChannelAdapterConfig);

      (adapter as unknown as { botUserId?: string }).botUserId = 'my-bot';

      await callHandleMessage(adapter, {
        id: 'msg-bot-ok',
        channelId: 'chan-1',
        content: 'Bot message allowed',
        guildId: 'guild-1',
        author: { id: 'other-bot-123', bot: true },
      });

      expect(publish).toHaveBeenCalledWith(
        'nachos.channel.discord.inbound',
        expect.objectContaining({
          sender: expect.objectContaining({ id: 'other-bot-123' }),
        })
      );
    });

    it('[BF-03] should filter bots by bot_allowlist when allow_bots is true', async () => {
      const adapter = new DiscordChannelAdapter();
      const publish = vi.fn();

      await adapter.initialize({
        config: {
          allow_bots: true,
          bot_allowlist: ['allowed-bot-1'],
          servers: [
            {
              id: 'guild-1',
              channel_ids: ['chan-1'],
              user_allowlist: ['unlisted-bot', 'allowed-bot-1'],
              mention_gating: false,
            },
          ],
        },
        secrets: {},
        bus: { publish, subscribe: async () => {} },
        securityMode: 'standard',
      } as ChannelAdapterConfig);

      (adapter as unknown as { botUserId?: string }).botUserId = 'my-bot';

      // Bot NOT in bot_allowlist should be dropped by bot filter (before group policy)
      await callHandleMessage(adapter, {
        id: 'msg-blocked-bot',
        channelId: 'chan-1',
        content: 'Not in allowlist',
        guildId: 'guild-1',
        author: { id: 'unlisted-bot', bot: true },
      });

      expect(publish).not.toHaveBeenCalled();

      // Bot IN bot_allowlist should pass bot filter and group policy
      await callHandleMessage(adapter, {
        id: 'msg-allowed-bot',
        channelId: 'chan-1',
        content: 'In allowlist',
        guildId: 'guild-1',
        author: { id: 'allowed-bot-1', bot: true },
      });

      expect(publish).toHaveBeenCalledWith(
        'nachos.channel.discord.inbound',
        expect.objectContaining({
          sender: expect.objectContaining({ id: 'allowed-bot-1' }),
        })
      );
    });

    it('[BF-07] should always pass non-bot messages through bot filtering', async () => {
      const adapter = new DiscordChannelAdapter();
      const publish = vi.fn();

      await adapter.initialize({
        config: {
          // allow_bots is false (default), but non-bot messages should still pass
          servers: [
            {
              id: 'guild-1',
              channel_ids: ['chan-1'],
              user_allowlist: ['user-human'],
              mention_gating: false,
            },
          ],
        },
        secrets: {},
        bus: { publish, subscribe: async () => {} },
        securityMode: 'standard',
      } as ChannelAdapterConfig);

      await callHandleMessage(adapter, {
        id: 'msg-human',
        channelId: 'chan-1',
        content: 'Human message',
        guildId: 'guild-1',
        author: { id: 'user-human', bot: false },
      });

      expect(publish).toHaveBeenCalledWith(
        'nachos.channel.discord.inbound',
        expect.objectContaining({
          sender: expect.objectContaining({ id: 'user-human' }),
        })
      );
    });
  });

  describe('Slash Commands', () => {
    // Discord.js PermissionFlagsBits reference:
    // Administrator = 1n << 3n = 8n
    // ManageGuild = 1n << 5n = 32n

    it('[SC-17] /nachos status should return channel status info', async () => {
      const adapter = new DiscordChannelAdapter();
      const publish = vi.fn();

      await adapter.initialize({
        config: {
          commands: { enabled: ['status'], admin_allowlist: ['user-1'] },
        },
        secrets: {},
        bus: { publish, subscribe: async () => {} },
        securityMode: 'standard',
      } as ChannelAdapterConfig);

      const interaction = createMockInteraction({
        subcommand: 'status',
        userId: 'user-1',
      });

      await callHandleCommandInteraction(adapter, interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Nachos Discord channel is running'),
          ephemeral: true,
        })
      );
    });

    it('[SC-20] /nachos help should list available commands', async () => {
      const adapter = new DiscordChannelAdapter();
      const publish = vi.fn();

      await adapter.initialize({
        config: {
          commands: { enabled: ['help'], admin_allowlist: ['user-1'] },
        },
        secrets: {},
        bus: { publish, subscribe: async () => {} },
        securityMode: 'standard',
      } as ChannelAdapterConfig);

      const interaction = createMockInteraction({
        subcommand: 'help',
        userId: 'user-1',
      });

      await callHandleCommandInteraction(adapter, interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Available commands'),
          ephemeral: true,
        })
      );
    });

    it('[SC-12] /nachos session reset should create new session via inbound bus message', async () => {
      const adapter = new DiscordChannelAdapter();
      const publish = vi.fn();

      await adapter.initialize({
        config: {
          commands: { enabled: ['session.reset'], admin_allowlist: ['user-1'] },
        },
        secrets: {},
        bus: { publish, subscribe: async () => {} },
        securityMode: 'standard',
      } as ChannelAdapterConfig);

      const interaction = createMockInteraction({
        subcommand: 'reset',
        subcommandGroup: 'session',
        userId: 'user-1',
      });

      await callHandleCommandInteraction(adapter, interaction);

      // Should dispatch /reset to NATS
      expect(publish).toHaveBeenCalledWith(
        'nachos.channel.discord.inbound',
        expect.objectContaining({
          content: expect.objectContaining({ text: '/reset' }),
          metadata: expect.objectContaining({ source: 'slash_command' }),
        })
      );

      // Should also publish audit
      expect(publish).toHaveBeenCalledWith(
        'nachos.audit.log',
        expect.objectContaining({
          resource: 'session.reset',
          outcome: 'allowed',
        })
      );

      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    });

    it('[SC-06] disabled command should return error message', async () => {
      const adapter = new DiscordChannelAdapter();
      const publish = vi.fn();

      await adapter.initialize({
        config: {
          commands: { enabled: ['help'], admin_allowlist: ['user-1'] },
        },
        secrets: {},
        bus: { publish, subscribe: async () => {} },
        securityMode: 'standard',
      } as ChannelAdapterConfig);

      const interaction = createMockInteraction({
        subcommand: 'status',
        userId: 'user-1',
      });

      await callHandleCommandInteraction(adapter, interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Command is not enabled.',
          ephemeral: true,
        })
      );
    });

    it('[SC-10] unauthorized user should get permission denied', async () => {
      const adapter = new DiscordChannelAdapter();
      const publish = vi.fn();

      await adapter.initialize({
        config: {
          commands: { enabled: ['status'], admin_allowlist: ['admin-1'] },
        },
        secrets: {},
        bus: { publish, subscribe: async () => {} },
        securityMode: 'standard',
      } as ChannelAdapterConfig);

      // User not in admin_allowlist and no Admin/ManageGuild permissions
      const interaction = createMockInteraction({
        subcommand: 'status',
        userId: 'unauthorized-user',
        permissions: new Set<bigint>(),
      });

      await callHandleCommandInteraction(adapter, interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Permission denied for this command.',
          ephemeral: true,
        })
      );
    });

    it('[SC-22] dispatched command message should include metadata.source slash_command', async () => {
      const adapter = new DiscordChannelAdapter();
      const publish = vi.fn();

      await adapter.initialize({
        config: {
          commands: { enabled: ['session'], admin_allowlist: ['user-1'] },
        },
        secrets: {},
        bus: { publish, subscribe: async () => {} },
        securityMode: 'standard',
      } as ChannelAdapterConfig);

      const interaction = createMockInteraction({
        subcommand: 'reset',
        subcommandGroup: 'session',
        userId: 'user-1',
      });

      await callHandleCommandInteraction(adapter, interaction);

      const inboundCall = publish.mock.calls.find(
        (call: unknown[]) => call[0] === 'nachos.channel.discord.inbound'
      );
      expect(inboundCall).toBeDefined();
      expect((inboundCall![1] as Record<string, unknown>).metadata).toEqual(
        expect.objectContaining({ source: 'slash_command' })
      );
    });

    it('[SC-18] /nachos config show should return config info', async () => {
      const adapter = new DiscordChannelAdapter();
      const publish = vi.fn();

      await adapter.initialize({
        config: {
          commands: { enabled: ['config.show'], admin_allowlist: ['user-1'] },
          servers: [
            {
              id: 'guild-1',
              channel_ids: ['chan-1'],
              user_allowlist: ['user-1'],
              mention_gating: true,
            },
          ],
        },
        secrets: {},
        bus: { publish, subscribe: async () => {} },
        securityMode: 'standard',
      } as ChannelAdapterConfig);

      const interaction = createMockInteraction({
        subcommand: 'show',
        subcommandGroup: 'config',
        userId: 'user-1',
        guildId: 'guild-1',
      });

      await callHandleCommandInteraction(adapter, interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Server policy'),
          ephemeral: true,
        })
      );
    });

    it('[SC-13] /nachos context on/off/status should toggle context management', async () => {
      const adapter = new DiscordChannelAdapter();
      const publish = vi.fn();

      await adapter.initialize({
        config: {
          commands: { enabled: ['context'], admin_allowlist: ['user-1'] },
        },
        secrets: {},
        bus: { publish, subscribe: async () => {} },
        securityMode: 'standard',
      } as ChannelAdapterConfig);

      // Test context on
      const interactionOn = createMockInteraction({
        subcommand: 'on',
        subcommandGroup: 'context',
        userId: 'user-1',
      });

      await callHandleCommandInteraction(adapter, interactionOn);

      expect(publish).toHaveBeenCalledWith(
        'nachos.channel.discord.inbound',
        expect.objectContaining({
          content: expect.objectContaining({ text: '/context on' }),
        })
      );

      publish.mockClear();

      // Test context off
      const interactionOff = createMockInteraction({
        subcommand: 'off',
        subcommandGroup: 'context',
        userId: 'user-1',
      });

      await callHandleCommandInteraction(adapter, interactionOff);

      expect(publish).toHaveBeenCalledWith(
        'nachos.channel.discord.inbound',
        expect.objectContaining({
          content: expect.objectContaining({ text: '/context off' }),
        })
      );

      publish.mockClear();

      // Test context status
      const interactionStatus = createMockInteraction({
        subcommand: 'status',
        subcommandGroup: 'context',
        userId: 'user-1',
      });

      await callHandleCommandInteraction(adapter, interactionStatus);

      expect(publish).toHaveBeenCalledWith(
        'nachos.channel.discord.inbound',
        expect.objectContaining({
          content: expect.objectContaining({ text: '/context status' }),
        })
      );
    });
  });

  describe('Env-to-Config Bridge', () => {
    const ENV_KEYS = [
      'CHANNEL_DISCORD_GUILD_ID',
      'CHANNEL_DISCORD_CHANNEL_IDS',
      'CHANNEL_DISCORD_USER_ALLOWLIST',
      'CHANNEL_DISCORD_MENTION_GATING',
      'CHANNEL_DISCORD_DM_ALLOWLIST',
    ] as const;

    afterEach(() => {
      for (const key of ENV_KEYS) {
        delete process.env[key];
      }
    });

    it('[EB-01] builds server config from env vars when TOML servers is missing', () => {
      process.env.CHANNEL_DISCORD_GUILD_ID = '123456789';
      process.env.CHANNEL_DISCORD_CHANNEL_IDS = 'chan-1,chan-2';
      process.env.CHANNEL_DISCORD_USER_ALLOWLIST = 'user-a,user-b';
      process.env.CHANNEL_DISCORD_MENTION_GATING = 'true';

      const channelConfig: Record<string, unknown> = {};
      applyEnvBridge(channelConfig);

      const servers = channelConfig.servers as Array<Record<string, unknown>>;
      expect(servers).toHaveLength(1);
      expect(servers[0]).toEqual({
        ids: ['123456789'],
        channel_ids: ['chan-1', 'chan-2'],
        user_allowlist: ['user-a', 'user-b'],
        mention_gating: true,
      });
    });

    it('[EB-02] builds DM allowlist from env var when TOML dm is missing', () => {
      process.env.CHANNEL_DISCORD_DM_ALLOWLIST = 'dm-user-1,dm-user-2';

      const channelConfig: Record<string, unknown> = {};
      applyEnvBridge(channelConfig);

      const dm = channelConfig.dm as { user_allowlist: string[] };
      expect(dm.user_allowlist).toEqual(['dm-user-1', 'dm-user-2']);
    });

    it('[EB-03] does not override TOML servers when they exist', () => {
      process.env.CHANNEL_DISCORD_GUILD_ID = 'env-guild';
      process.env.CHANNEL_DISCORD_USER_ALLOWLIST = 'env-user';

      const channelConfig: Record<string, unknown> = {
        servers: [{ ids: ['toml-guild'], channel_ids: [], user_allowlist: ['toml-user'] }],
      };
      applyEnvBridge(channelConfig);

      const servers = channelConfig.servers as Array<Record<string, unknown>>;
      expect(servers).toHaveLength(1);
      expect(servers[0]).toEqual(
        expect.objectContaining({ ids: ['toml-guild'], user_allowlist: ['toml-user'] })
      );
    });

    it('[EB-04] does not override TOML dm allowlist when it exists', () => {
      process.env.CHANNEL_DISCORD_DM_ALLOWLIST = 'env-dm-user';

      const channelConfig: Record<string, unknown> = {
        dm: { user_allowlist: ['toml-dm-user'] },
      };
      applyEnvBridge(channelConfig);

      const dm = channelConfig.dm as { user_allowlist: string[] };
      expect(dm.user_allowlist).toEqual(['toml-dm-user']);
    });

    it('[EB-05] mention_gating defaults to true unless explicitly set to false', () => {
      process.env.CHANNEL_DISCORD_GUILD_ID = '999';
      // CHANNEL_DISCORD_MENTION_GATING not set — should default to true
      const channelConfig: Record<string, unknown> = {};
      applyEnvBridge(channelConfig);

      const servers = channelConfig.servers as Array<Record<string, unknown>>;
      expect(servers[0]?.mention_gating).toBe(true);

      // Now set to 'false'
      process.env.CHANNEL_DISCORD_MENTION_GATING = 'false';
      const channelConfig2: Record<string, unknown> = {};
      applyEnvBridge(channelConfig2);

      const servers2 = channelConfig2.servers as Array<Record<string, unknown>>;
      expect(servers2[0]?.mention_gating).toBe(false);
    });
  });
});
