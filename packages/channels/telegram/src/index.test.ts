import { describe, it, expect, vi, afterEach } from 'vitest';
import { TelegramChannelAdapter } from './index.js';
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

describe('TelegramChannelAdapter', () => {
  afterEach(() => {
    delete process.env.RUNTIME_STATE_DIR;
    delete process.env.NACHOS_PAIRING_TOKEN;
  });

  it('throws when token is missing', async () => {
    const adapter = new TelegramChannelAdapter();

    const config: ChannelAdapterConfig = {
      config: {},
      secrets: {},
      bus: {
        publish: async () => {},
        subscribe: async () => {},
      },
      securityMode: 'standard',
    };

    await expect(adapter.initialize(config)).rejects.toThrow('Telegram token is required');
  });

  it('publishes inbound DM messages when allowlisted', async () => {
    const adapter = new TelegramChannelAdapter();
    const publish = vi.fn();

    const config: ChannelAdapterConfig = {
      config: { dm: { user_allowlist: ['100'] } },
      secrets: {},
      bus: {
        publish,
        subscribe: async () => {},
      },
      securityMode: 'standard',
    };

    (adapter as unknown as { config?: ChannelAdapterConfig }).config = config;
    (adapter as unknown as { bot?: unknown }).bot = {} as unknown;

    const ctx = {
      message: {
        message_id: 10,
        text: 'Hello',
        chat: { id: 999, type: 'private' },
        from: { id: 100 },
      },
    };

    await (adapter as unknown as { handleMessage: (ctx: unknown) => Promise<void> }).handleMessage(
      ctx
    );

    expect(publish).toHaveBeenCalledWith(
      'nachos.channel.telegram.inbound',
      expect.objectContaining({
        sender: expect.objectContaining({ id: '100' }),
        conversation: expect.objectContaining({ id: '999', type: 'dm' }),
        content: expect.objectContaining({ text: 'Hello' }),
      })
    );
  });

  it('sends outbound messages via Telegram API', async () => {
    const adapter = new TelegramChannelAdapter();
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 42 });

    (adapter as unknown as { bot?: unknown }).bot = {
      telegram: { sendMessage },
    } as unknown;

    const result = await adapter.sendMessage({
      channel: 'telegram',
      conversationId: '999',
      content: { text: 'Hi' },
    });

    expect(result.success).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(999, 'Hi', undefined);
  });

  it('requires pairing token before allowing DMs when pairing enabled', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nachos-pairing-'));
    process.env.RUNTIME_STATE_DIR = tempDir;
    process.env.NACHOS_PAIRING_TOKEN = 'secret';

    const adapter = new TelegramChannelAdapter();
    const publish = vi.fn();

    (adapter as unknown as { config?: ChannelAdapterConfig }).config = {
      config: { dm: { user_allowlist: [], pairing: true } },
      secrets: {},
      bus: {
        publish,
        subscribe: async () => {},
      },
      securityMode: 'standard',
    } as ChannelAdapterConfig;

    vi.spyOn(adapter, 'sendMessage').mockResolvedValue({ success: true });
    (adapter as unknown as { bot?: unknown }).bot = {} as unknown;

    const handleMessage = (
      adapter as unknown as { handleMessage: (ctx: unknown) => Promise<void> }
    ).handleMessage.bind(adapter);

    await handleMessage({
      message: {
        message_id: 1,
        text: 'pair wrong',
        chat: { id: 999, type: 'private' },
        from: { id: 100 },
      },
    });

    expect(publish).not.toHaveBeenCalled();

    await handleMessage({
      message: {
        message_id: 2,
        text: 'pair secret',
        chat: { id: 999, type: 'private' },
        from: { id: 100 },
      },
    });

    await handleMessage({
      message: {
        message_id: 3,
        text: 'Hello after pairing',
        chat: { id: 999, type: 'private' },
        from: { id: 100 },
      },
    });

    expect(publish).toHaveBeenCalledWith(
      'nachos.channel.telegram.inbound',
      expect.objectContaining({
        sender: expect.objectContaining({ id: '100' }),
        content: expect.objectContaining({ text: 'Hello after pairing' }),
      })
    );
  });
});
