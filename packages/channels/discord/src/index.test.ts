import { describe, it, expect, vi, afterEach } from 'vitest';
import { DiscordChannelAdapter } from './index.js';
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
};

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

    await (adapter as unknown as { handleMessage: Function }).handleMessage(message);

    expect(publish).toHaveBeenCalledWith(
      'nachos.channel.discord.inbound',
      expect.objectContaining({
        sender: expect.objectContaining({ id: 'user-1' }),
        conversation: expect.objectContaining({ id: 'dm-1', type: 'dm' }),
        content: expect.objectContaining({ text: 'Hello' }),
      })
    );
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

    await (adapter as unknown as { handleMessage: Function }).handleMessage({
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

    const handleMessage = (adapter as unknown as { handleMessage: Function }).handleMessage.bind(
      adapter
    );

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
});
