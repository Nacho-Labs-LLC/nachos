import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WhatsappChannelAdapter } from './index.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type PublishCall = { topic: string; payload: unknown };

type ChannelAdapterConfig = {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  bus: {
    publish: (topic: string, payload: unknown) => void | Promise<void>;
    subscribe: (topic: string, handler: (payload: unknown) => void) => Promise<unknown>;
  };
  securityMode: 'strict' | 'standard' | 'permissive';
};

type OutboundMessage = {
  channel: string;
  conversationId: string;
  replyToMessageId?: string;
  content: { text: string };
};

describe('WhatsappChannelAdapter', () => {
  let adapter: WhatsappChannelAdapter;
  let publishCalls: PublishCall[];
  let config: ChannelAdapterConfig;

  beforeEach(() => {
    publishCalls = [];
    adapter = new WhatsappChannelAdapter();

    config = {
      config: {
        token: 'whatsapp-token',
        phone_number_id: 'phone-123',
        verify_token: 'verify-token',
        webhook_path: '/whatsapp/webhook',
        api_version: 'v20.0',
        dm: { user_allowlist: ['15551234567'] },
      },
      secrets: {},
      bus: {
        publish: async (topic: string, payload: unknown) => {
          publishCalls.push({ topic, payload });
        },
        subscribe: vi.fn().mockResolvedValue(undefined),
      },
      securityMode: 'standard',
    };

    process.env.WHATSAPP_HTTP_PORT = '0';
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.WHATSAPP_HTTP_PORT;
    delete process.env.RUNTIME_STATE_DIR;
    delete process.env.NACHOS_PAIRING_TOKEN;
    try {
      await adapter.stop();
    } catch {
      // ignore cleanup errors
    }
  });

  it('throws when required config is missing', async () => {
    await adapter.initialize({
      ...config,
      config: { dm: { user_allowlist: ['15551234567'] } },
    });

    await expect(adapter.start()).rejects.toThrow(
      'WhatsApp adapter requires token, phone_number_id, and verify_token'
    );
  });

  it('verifies webhook challenge', async () => {
    await adapter.initialize(config);
    await adapter.start();

    const port = ((adapter as unknown as { server?: { address: () => AddressInfo } })
      .server?.address() as AddressInfo).port;

    const response = await fetch(
      `http://localhost:${port}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=challenge-token`
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('challenge-token');
  });

  it('rejects webhook verification when token is invalid', async () => {
    await adapter.initialize(config);
    await adapter.start();

    const port = ((adapter as unknown as { server?: { address: () => AddressInfo } })
      .server?.address() as AddressInfo).port;

    const response = await fetch(
      `http://localhost:${port}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=bad-token&hub.challenge=challenge-token`
    );

    expect(response.status).toBe(403);
  });

  it('publishes inbound messages when allowlisted', async () => {
    await adapter.initialize({
      ...config,
      config: {
        ...config.config,
        app_secret: 'app-secret',
      },
    });
    await adapter.start();

    const port = ((adapter as unknown as { server?: { address: () => AddressInfo } })
      .server?.address() as AddressInfo).port;

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [
                  {
                    wa_id: '15551234567',
                    profile: { name: 'Test User' },
                  },
                ],
                metadata: {
                  phone_number_id: 'phone-123',
                  display_phone_number: '+1 555 123 4567',
                },
                messages: [
                  {
                    id: 'wamid.abc',
                    from: '15551234567',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'Hello Nachos' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha256', 'app-secret').update(rawBody).digest('hex');

    const response = await fetch(`http://localhost:${port}/whatsapp/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': `sha256=${signature}`,
      },
      body: rawBody,
    });

    expect(response.status).toBe(200);
    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0]?.topic).toBe('nachos.channel.whatsapp.inbound');

    const inbound = publishCalls[0]?.payload as {
      sender?: { id?: string; name?: string };
      conversation?: { id?: string; type?: string };
      content?: { text?: string };
    };

    expect(inbound.sender?.id).toBe('15551234567');
    expect(inbound.sender?.name).toBe('Test User');
    expect(inbound.conversation?.id).toBe('15551234567');
    expect(inbound.conversation?.type).toBe('dm');
    expect(inbound.content?.text).toBe('Hello Nachos');
  });

  it('rejects inbound webhook when signature is missing', async () => {
    await adapter.initialize({
      ...config,
      config: {
        ...config.config,
        app_secret: 'app-secret',
      },
    });
    await adapter.start();

    const port = ((adapter as unknown as { server?: { address: () => AddressInfo } })
      .server?.address() as AddressInfo).port;

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.abc',
                    from: '15551234567',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'Hello Nachos' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const response = await fetch(`http://localhost:${port}/whatsapp/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(403);
    expect(publishCalls).toHaveLength(0);
  });

  it('sends outbound messages via the Cloud API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.outbound' }] }),
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await adapter.initialize(config);

    const outbound: OutboundMessage = {
      channel: 'whatsapp',
      conversationId: '15551234567',
      content: { text: 'Hi there' },
    };

    const result = await adapter.sendMessage(outbound);

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('wamid.outbound');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requires pairing token before allowing DMs when pairing enabled', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nachos-pairing-'));
    process.env.RUNTIME_STATE_DIR = tempDir;
    process.env.NACHOS_PAIRING_TOKEN = 'secret';

    const publish = vi.fn();
    adapter = new WhatsappChannelAdapter();

    await adapter.initialize({
      ...config,
      config: {
        ...config.config,
        dm: { user_allowlist: [], pairing: true },
      },
      bus: {
        publish,
        subscribe: vi.fn().mockResolvedValue(undefined),
      },
    });

    vi.spyOn(adapter, 'sendMessage').mockResolvedValue({ success: true });

    const handleWebhookPayload = (
      adapter as unknown as { handleWebhookPayload: Function }
    ).handleWebhookPayload.bind(adapter);

    await handleWebhookPayload({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.1',
                    from: '15551234567',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'pair wrong' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(publish).not.toHaveBeenCalled();

    await handleWebhookPayload({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.2',
                    from: '15551234567',
                    timestamp: '1700000001',
                    type: 'text',
                    text: { body: 'pair secret' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    await handleWebhookPayload({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.3',
                    from: '15551234567',
                    timestamp: '1700000002',
                    type: 'text',
                    text: { body: 'Hello after pairing' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(publish).toHaveBeenCalledWith(
      'nachos.channel.whatsapp.inbound',
      expect.objectContaining({
        sender: expect.objectContaining({ id: '15551234567' }),
        content: expect.objectContaining({ text: 'Hello after pairing' }),
      })
    );
  });
});
