import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { App } from '@slack/bolt';
import { SlackChannelAdapter } from './index.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('@slack/bolt', () => ({ App: vi.fn() }));

type ChannelAdapterConfig = {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  bus: {
    publish: (topic: string, payload: unknown) => void | Promise<void>;
    subscribe: (topic: string, handler: (payload: unknown) => void) => Promise<unknown>;
  };
  securityMode: 'strict' | 'standard' | 'permissive';
};

describe('SlackChannelAdapter', () => {
  const appInstances: Array<{
    client: {
      auth: { test: ReturnType<typeof vi.fn> };
      chat: { postMessage: ReturnType<typeof vi.fn> };
    };
    event: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];

  beforeEach(() => {
    appInstances.length = 0;
    vi.mocked(App).mockImplementation(() => {
      const instance = {
        client: {
          auth: { test: vi.fn().mockResolvedValue({ user_id: 'U123' }) },
          chat: { postMessage: vi.fn().mockResolvedValue({ ts: '123.456' }) },
        },
        event: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      appInstances.push(instance);
      return instance;
    });
  });

  afterEach(() => {
    delete process.env.RUNTIME_STATE_DIR;
    delete process.env.NACHOS_PAIRING_TOKEN;
  });

  const baseConfig: ChannelAdapterConfig = {
    config: {},
    secrets: {},
    bus: {
      publish: async () => {},
      subscribe: async () => {},
    },
    securityMode: 'standard',
  };

  it('throws when socket mode tokens are missing', async () => {
    const adapter = new SlackChannelAdapter();

    await expect(adapter.initialize(baseConfig)).rejects.toThrow(
      'Slack socket mode requires app_token and bot_token'
    );
  });

  it('throws when http mode tokens are missing', async () => {
    const adapter = new SlackChannelAdapter();

    await expect(
      adapter.initialize({
        ...baseConfig,
        config: { mode: 'http' },
      })
    ).rejects.toThrow('Slack http mode requires bot_token and signing_secret');
  });

  it('uses webhook_path for http mode endpoints', async () => {
    const adapter = new SlackChannelAdapter();

    await adapter.initialize({
      ...baseConfig,
      config: { mode: 'http', webhook_path: '/slack/custom' },
      secrets: {
        SLACK_BOT_TOKEN: 'xoxb-token',
        SLACK_SIGNING_SECRET: 'signing-secret',
      },
    });

    const appMock = vi.mocked(App);
    expect(appMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoints: '/slack/custom' })
    );
  });

  it('publishes inbound DM messages when allowlisted', async () => {
    const publish = vi.fn();
    const adapter = new SlackChannelAdapter();

    await adapter.initialize({
      ...baseConfig,
      config: { dm: { user_allowlist: ['U111'] } },
      secrets: { SLACK_APP_TOKEN: 'app-token', SLACK_BOT_TOKEN: 'bot-token' },
      bus: {
        publish,
        subscribe: async () => {},
      },
    });

    await (adapter as unknown as { handleMessage: Function }).handleMessage(
      {
        type: 'message',
        user: 'U111',
        text: 'Hello',
        ts: '123.456',
        channel: 'D123',
        channel_type: 'im',
      },
      { dm: { user_allowlist: ['U111'] } }
    );

    expect(publish).toHaveBeenCalledWith(
      'nachos.channel.slack.inbound',
      expect.objectContaining({
        sender: expect.objectContaining({ id: 'U111' }),
        conversation: expect.objectContaining({ id: 'D123', type: 'dm' }),
        content: expect.objectContaining({ text: 'Hello' }),
      })
    );
  });

  it('sends outbound messages via Slack API', async () => {
    const adapter = new SlackChannelAdapter();

    await adapter.initialize({
      ...baseConfig,
      config: {},
      secrets: { SLACK_APP_TOKEN: 'app-token', SLACK_BOT_TOKEN: 'bot-token' },
    });

    const result = await adapter.sendMessage({
      channel: 'slack',
      conversationId: 'C123',
      content: { text: 'Hi' },
    });

    expect(result.success).toBe(true);
    expect(appInstances[0]?.client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C123', text: 'Hi' })
    );
  });

  it('requires pairing token before allowing DMs when pairing enabled', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nachos-pairing-'));
    process.env.RUNTIME_STATE_DIR = tempDir;
    process.env.NACHOS_PAIRING_TOKEN = 'secret';

    const publish = vi.fn();
    const adapter = new SlackChannelAdapter();

    await adapter.initialize({
      ...baseConfig,
      config: { dm: { user_allowlist: [], pairing: true } },
      secrets: { SLACK_APP_TOKEN: 'app-token', SLACK_BOT_TOKEN: 'bot-token' },
      bus: {
        publish,
        subscribe: async () => {},
      },
    });

    await (adapter as unknown as { handleMessage: Function }).handleMessage(
      {
        type: 'message',
        user: 'U999',
        text: 'pair wrong',
        ts: '1',
        channel: 'D1',
        channel_type: 'im',
      },
      { dm: { user_allowlist: [], pairing: true } }
    );

    expect(publish).not.toHaveBeenCalled();

    await (adapter as unknown as { handleMessage: Function }).handleMessage(
      {
        type: 'message',
        user: 'U999',
        text: 'pair secret',
        ts: '2',
        channel: 'D1',
        channel_type: 'im',
      },
      { dm: { user_allowlist: [], pairing: true } }
    );

    await (adapter as unknown as { handleMessage: Function }).handleMessage(
      {
        type: 'message',
        user: 'U999',
        text: 'Hello after pairing',
        ts: '3',
        channel: 'D1',
        channel_type: 'im',
      },
      { dm: { user_allowlist: [], pairing: true } }
    );

    expect(publish).toHaveBeenCalledWith(
      'nachos.channel.slack.inbound',
      expect.objectContaining({
        sender: expect.objectContaining({ id: 'U999' }),
        content: expect.objectContaining({ text: 'Hello after pairing' }),
      })
    );
  });
});
