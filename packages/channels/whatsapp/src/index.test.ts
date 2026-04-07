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
  content: { text: string; attachments?: Array<{ type: string; data: unknown; name?: string }> };
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

    const port = (
      (
        adapter as unknown as { server?: { address: () => AddressInfo } }
      ).server?.address() as AddressInfo
    ).port;

    const response = await fetch(
      `http://localhost:${port}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=challenge-token`
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('challenge-token');
  });

  it('rejects webhook verification when token is invalid', async () => {
    await adapter.initialize(config);
    await adapter.start();

    const port = (
      (
        adapter as unknown as { server?: { address: () => AddressInfo } }
      ).server?.address() as AddressInfo
    ).port;

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

    const port = (
      (
        adapter as unknown as { server?: { address: () => AddressInfo } }
      ).server?.address() as AddressInfo
    ).port;

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

    const port = (
      (
        adapter as unknown as { server?: { address: () => AddressInfo } }
      ).server?.address() as AddressInfo
    ).port;

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
      adapter as unknown as { handleWebhookPayload: (payload: unknown) => Promise<void> }
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

  describe('typing indicators', () => {
    it('starts typing indicator on thinking event and stops on done', async () => {
      await adapter.initialize(config);
      await adapter.start();

      const subscribe = config.bus.subscribe as ReturnType<typeof vi.fn>;
      const handlers = new Map<string, (event: unknown) => Promise<void>>();

      // Capture all the subscription handlers
      for (const call of subscribe.mock.calls) {
        const topic = call[0] as string;
        const handler = call[1] as (event: unknown) => Promise<void>;
        handlers.set(topic, handler);
      }

      // Verify all four status event subscriptions were created
      expect(handlers.has('nachos.status.*.thinking')).toBe(true);
      expect(handlers.has('nachos.status.*.tool')).toBe(true);
      expect(handlers.has('nachos.status.*.done')).toBe(true);
      expect(handlers.has('nachos.status.*.error')).toBe(true);

      // Trigger thinking event
      const thinkingHandler = handlers.get('nachos.status.*.thinking');
      expect(thinkingHandler).toBeDefined();

      // Access internal typingIntervals map
      const typingIntervals = (
        adapter as unknown as { typingIntervals: Map<string, NodeJS.Timeout> }
      ).typingIntervals;

      await thinkingHandler!({
        sessionId: 'sess-1',
        status: 'thinking',
        channelId: '15551234567',
        channelMessageId: 'wamid.abc',
      });

      // Should have started a typing interval for this conversation
      expect(typingIntervals.has('15551234567')).toBe(true);

      // Trigger done event to stop
      const doneHandler = handlers.get('nachos.status.*.done');
      await doneHandler!({
        sessionId: 'sess-1',
        status: 'done',
        channelId: '15551234567',
      });

      // Typing interval should be cleared
      expect(typingIntervals.has('15551234567')).toBe(false);
    });

    it('handles tool events by maintaining typing indicator', async () => {
      await adapter.initialize(config);
      await adapter.start();

      const subscribe = config.bus.subscribe as ReturnType<typeof vi.fn>;
      const handlers = new Map<string, (event: unknown) => Promise<void>>();

      for (const call of subscribe.mock.calls) {
        handlers.set(call[0] as string, call[1] as (event: unknown) => Promise<void>);
      }

      const toolHandler = handlers.get('nachos.status.*.tool');
      expect(toolHandler).toBeDefined();

      const typingIntervals = (
        adapter as unknown as { typingIntervals: Map<string, NodeJS.Timeout> }
      ).typingIntervals;

      await toolHandler!({
        sessionId: 'sess-1',
        status: 'tool',
        channelId: '15551234567',
        toolName: 'web-fetch',
      });

      expect(typingIntervals.has('15551234567')).toBe(true);

      // Error should also stop typing
      const errorHandler = handlers.get('nachos.status.*.error');
      await errorHandler!({
        sessionId: 'sess-1',
        status: 'error',
        channelId: '15551234567',
      });

      expect(typingIntervals.has('15551234567')).toBe(false);
    });
  });

  describe('inbound file handling', () => {
    it('publishes inbound image messages with downloaded media data', async () => {
      // Mock fetch: first call is markMessageAsRead, second is getMediaUrl,
      // third is downloadMedia
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          // markMessageAsRead
          ok: true,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          // getMediaUrl
          ok: true,
          json: async () => ({ url: 'https://media.whatsapp.net/image123' }),
        })
        .mockResolvedValueOnce({
          // downloadMedia
          ok: true,
          headers: new Map([
            ['content-type', 'image/jpeg'],
            ['content-length', '100'],
          ]),
          arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff]).buffer,
        });

      vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

      await adapter.initialize(config);

      const handleWebhookPayload = (
        adapter as unknown as { handleWebhookPayload: (payload: unknown) => Promise<void> }
      ).handleWebhookPayload.bind(adapter);

      await handleWebhookPayload({
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ wa_id: '15551234567', profile: { name: 'Test User' } }],
                  metadata: { phone_number_id: 'phone-123' },
                  messages: [
                    {
                      id: 'wamid.img1',
                      from: '15551234567',
                      timestamp: '1700000000',
                      type: 'image',
                      image: {
                        id: 'media-id-123',
                        mime_type: 'image/jpeg',
                        caption: 'A photo',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      });

      expect(publishCalls).toHaveLength(1);
      const inbound = publishCalls[0]?.payload as {
        content?: {
          text?: string;
          attachments?: Array<{
            type: string;
            url: string;
            name?: string;
            mimeType?: string;
          }>;
        };
        metadata?: { mediaType?: string };
      };

      expect(inbound.content?.text).toBe('A photo');
      expect(inbound.content?.attachments).toHaveLength(1);
      expect(inbound.content?.attachments?.[0]?.type).toBe('image');
      expect(inbound.content?.attachments?.[0]?.mimeType).toBe('image/jpeg');
      // Should be a data URI since download succeeded
      expect(inbound.content?.attachments?.[0]?.url).toMatch(/^data:image\/jpeg;base64,/);
      expect(inbound.metadata?.mediaType).toBe('image');
    });

    it('falls back to media URL when download fails', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          // markMessageAsRead
          ok: true,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          // getMediaUrl
          ok: true,
          json: async () => ({ url: 'https://media.whatsapp.net/doc456' }),
        })
        .mockResolvedValueOnce({
          // downloadMedia - fails
          ok: false,
          status: 500,
          headers: new Map(),
        });

      vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

      await adapter.initialize(config);

      const handleWebhookPayload = (
        adapter as unknown as { handleWebhookPayload: (payload: unknown) => Promise<void> }
      ).handleWebhookPayload.bind(adapter);

      await handleWebhookPayload({
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ wa_id: '15551234567', profile: { name: 'User' } }],
                  messages: [
                    {
                      id: 'wamid.doc1',
                      from: '15551234567',
                      timestamp: '1700000000',
                      type: 'document',
                      document: {
                        id: 'media-id-456',
                        mime_type: 'application/pdf',
                        filename: 'report.pdf',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      });

      expect(publishCalls).toHaveLength(1);
      const inbound = publishCalls[0]?.payload as {
        content?: {
          attachments?: Array<{ url: string; name?: string }>;
        };
      };

      // Should fall back to the WhatsApp media URL
      expect(inbound.content?.attachments?.[0]?.url).toBe('https://media.whatsapp.net/doc456');
      expect(inbound.content?.attachments?.[0]?.name).toBe('report.pdf');
    });

    it('handles audio, video, and sticker media types', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // markAsRead
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ url: 'https://media.whatsapp.net/audio1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map([['content-type', 'audio/ogg']]),
          arrayBuffer: async () => new Uint8Array([0x4f, 0x67, 0x67]).buffer,
        });

      vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

      await adapter.initialize(config);

      const handleWebhookPayload = (
        adapter as unknown as { handleWebhookPayload: (payload: unknown) => Promise<void> }
      ).handleWebhookPayload.bind(adapter);

      await handleWebhookPayload({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'wamid.audio1',
                      from: '15551234567',
                      timestamp: '1700000000',
                      type: 'audio',
                      audio: {
                        id: 'media-audio-1',
                        mime_type: 'audio/ogg',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      });

      expect(publishCalls).toHaveLength(1);
      const inbound = publishCalls[0]?.payload as {
        content?: {
          text?: string;
          attachments?: Array<{ type: string; mimeType?: string }>;
        };
      };

      expect(inbound.content?.text).toBe('[audio]');
      expect(inbound.content?.attachments?.[0]?.type).toBe('audio');
      expect(inbound.content?.attachments?.[0]?.mimeType).toBe('audio/ogg');
    });
  });

  describe('outbound file handling', () => {
    it('sends URL-based media attachments', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: 'wamid.outbound' }] }),
      });

      vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

      await adapter.initialize(config);

      const outbound = {
        channel: 'whatsapp',
        conversationId: '15551234567',
        content: {
          text: 'Here is an image',
          attachments: [
            {
              type: 'image',
              data: 'https://example.com/photo.jpg',
              name: 'photo.jpg',
            },
          ],
        },
      };

      const result = await adapter.sendMessage(outbound);

      expect(result.success).toBe(true);
      // Two calls: text message + media message
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Verify the media message payload
      const mediaCall = fetchMock.mock.calls[1];
      const mediaBody = JSON.parse(mediaCall[1].body as string) as Record<string, unknown>;
      expect(mediaBody.type).toBe('image');
      expect((mediaBody.image as Record<string, string>).link).toBe(
        'https://example.com/photo.jpg'
      );
    });

    it('uploads base64 data and sends via media ID', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          // Text message
          ok: true,
          json: async () => ({ messages: [{ id: 'wamid.outbound' }] }),
        })
        .mockResolvedValueOnce({
          // Media upload
          ok: true,
          json: async () => ({ id: 'uploaded-media-id' }),
        })
        .mockResolvedValueOnce({
          // Media message send
          ok: true,
          json: async () => ({ messages: [{ id: 'wamid.media' }] }),
        });

      vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

      await adapter.initialize(config);

      const base64Data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

      const outbound = {
        channel: 'whatsapp',
        conversationId: '15551234567',
        content: {
          text: 'Here is an image',
          attachments: [
            {
              type: 'image',
              data: base64Data,
              name: 'screenshot.png',
            },
          ],
        },
      };

      const result = await adapter.sendMessage(outbound);

      expect(result.success).toBe(true);
      // Three calls: text message + upload + media message
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Verify upload call went to the media endpoint
      const uploadCall = fetchMock.mock.calls[1];
      const uploadUrl = uploadCall[0] as string;
      expect(uploadUrl).toContain('/media');

      // Verify the media message used the uploaded media ID
      const mediaCall = fetchMock.mock.calls[2];
      const mediaBody = JSON.parse(mediaCall[1].body as string) as Record<string, unknown>;
      expect(mediaBody.type).toBe('image');
      expect((mediaBody.image as Record<string, string>).id).toBe('uploaded-media-id');
    });

    it('falls back to document type for unknown attachment types', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.outbound' }] }),
      });

      vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

      await adapter.initialize(config);

      const outbound = {
        channel: 'whatsapp',
        conversationId: '15551234567',
        content: {
          text: 'Here is a file',
          attachments: [
            {
              type: 'file',
              data: 'https://example.com/report.pdf',
              name: 'report.pdf',
            },
          ],
        },
      };

      const result = await adapter.sendMessage(outbound);

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const mediaCall = fetchMock.mock.calls[1];
      const mediaBody = JSON.parse(mediaCall[1].body as string) as Record<string, unknown>;
      expect(mediaBody.type).toBe('document');
      expect((mediaBody.document as Record<string, string>).filename).toBe('report.pdf');
    });

    it('skips non-string attachment data gracefully', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.outbound' }] }),
      });

      vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

      await adapter.initialize(config);

      const outbound = {
        channel: 'whatsapp',
        conversationId: '15551234567',
        content: {
          text: 'Message with bad attachment',
          attachments: [
            {
              type: 'image',
              data: 12345, // Not a string
              name: 'bad.jpg',
            },
          ],
        },
      };

      const result = await adapter.sendMessage(outbound);

      expect(result.success).toBe(true);
      // Only one call: text message (media skipped)
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
