/**
 * Matrix Channel Adapter Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MatrixChannelAdapter } from './index.js';
import { applyEnvBridge } from './main.js';

type ChannelAdapterConfig = {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  bus: {
    publish: (topic: string, payload: unknown) => void | Promise<void>;
    subscribe: <T>(
      topic: string,
      handler: (payload: T) => void | Promise<void>
    ) => Promise<unknown>;
  };
  securityMode: 'strict' | 'standard' | 'permissive';
  dmPolicy?: {
    userAllowlist: string[];
    pairing?: boolean;
  };
};

/**
 * Helper: call private handleTimelineEvent on an adapter instance.
 */
function callHandleTimelineEvent(adapter: MatrixChannelAdapter, event: unknown): Promise<void> {
  return (
    adapter as unknown as { handleTimelineEvent: (event: unknown) => Promise<void> }
  ).handleTimelineEvent(event);
}

/** Helper: create a minimal MatrixEvent-like object */
function createMatrixEvent(overrides?: {
  sender?: string;
  type?: string;
  roomId?: string;
  eventId?: string;
  content?: Record<string, unknown>;
  ts?: number;
}) {
  const sender = overrides?.sender ?? '@alice:example.com';
  const type = overrides?.type ?? 'm.room.message';
  const roomId = overrides?.roomId ?? '!room1:example.com';
  const eventId = overrides?.eventId ?? '$event1';
  const content = overrides?.content ?? { msgtype: 'm.text', body: 'Hello' };
  const ts = overrides?.ts ?? Date.now();

  return {
    getSender: () => sender,
    getType: () => type,
    getRoomId: () => roomId,
    getId: () => eventId,
    getContent: () => content,
    getTs: () => ts,
  };
}

describe('MatrixChannelAdapter', () => {
  let adapter: MatrixChannelAdapter;
  let mockBus: {
    publish: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  };
  let mockConfig: ChannelAdapterConfig;

  beforeEach(() => {
    adapter = new MatrixChannelAdapter();

    mockBus = {
      publish: vi.fn(),
      subscribe: vi.fn(),
    };

    mockConfig = {
      config: {
        homeserver_url: 'https://matrix.example.com',
        user_id: '@bot:example.com',
        access_token: 'test_token_12345',
        device_id: 'NACHOS_TEST',
      },
      secrets: {},
      bus: mockBus,
      securityMode: 'standard',
      dmPolicy: {
        userAllowlist: ['@alice:example.com'],
        pairing: false,
      },
    };
  });

  afterEach(() => {
    delete process.env.RUNTIME_STATE_DIR;
    delete process.env.NACHOS_PAIRING_TOKEN;
  });

  describe('properties', () => {
    it('should have correct channelId', () => {
      expect(adapter.channelId).toBe('matrix');
    });

    it('should have correct name', () => {
      expect(adapter.name).toBe('Matrix');
    });
  });

  describe('initialization', () => {
    it('should initialize with valid config', async () => {
      await expect(adapter.initialize(mockConfig)).resolves.not.toThrow();
    });

    it('should throw error if homeserver URL is missing', async () => {
      const invalidConfig: ChannelAdapterConfig = {
        ...mockConfig,
        config: {
          user_id: '@bot:example.com',
          access_token: 'test_token_12345',
        },
      };

      await expect(adapter.initialize(invalidConfig)).rejects.toThrow(
        'Matrix homeserver URL is required'
      );
    });

    it('should throw error if access token is missing', async () => {
      const invalidConfig: ChannelAdapterConfig = {
        ...mockConfig,
        config: {
          homeserver_url: 'https://matrix.example.com',
          user_id: '@bot:example.com',
        },
      };

      await expect(adapter.initialize(invalidConfig)).rejects.toThrow(
        'Matrix access token is required'
      );
    });

    it('should throw error if user ID is missing', async () => {
      const invalidConfig: ChannelAdapterConfig = {
        ...mockConfig,
        config: {
          homeserver_url: 'https://matrix.example.com',
          access_token: 'test_token_12345',
        },
      };

      await expect(adapter.initialize(invalidConfig)).rejects.toThrow('Matrix user ID is required');
    });

    it('should resolve credentials from secrets when config is empty', async () => {
      const configWithSecrets: ChannelAdapterConfig = {
        config: {},
        secrets: {
          MATRIX_HOMESERVER_URL: 'https://matrix.example.com',
          MATRIX_ACCESS_TOKEN: 'secret_token',
          MATRIX_USER_ID: '@bot:example.com',
        },
        bus: mockBus,
        securityMode: 'standard',
      };

      await expect(adapter.initialize(configWithSecrets)).resolves.not.toThrow();
    });
  });

  describe('start', () => {
    it('should throw if not initialized', async () => {
      await expect(adapter.start()).rejects.toThrow('Matrix adapter not initialized');
    });
  });

  describe('sendMessage', () => {
    it('should return error if client not initialized', async () => {
      const message = {
        channel: 'matrix',
        conversationId: '!room123:example.com',
        content: {
          text: 'Hello, world!',
          format: 'plain' as const,
        },
      };

      const result = await adapter.sendMessage(message);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CLIENT_NOT_INITIALIZED');
      expect(result.error?.retryable).toBe(false);
    });
  });

  describe('healthCheck', () => {
    it('should return unhealthy if client not running', async () => {
      const health = await adapter.healthCheck();
      expect(health).toBe('unhealthy');
    });
  });

  describe('handleTimelineEvent', () => {
    /** Helper to mock the client with a room */
    function patchClient(
      adapterInstance: MatrixChannelAdapter,
      mockRoom: Record<string, unknown>,
      extraClient?: Record<string, unknown>
    ) {
      const existing = (adapterInstance as unknown as { client: Record<string, unknown> }).client;
      (adapterInstance as unknown as { client: Record<string, unknown> }).client = {
        ...existing,
        getRoom: () => mockRoom,
        getUser: () => null,
        mxcUrlToHttp: () => null,
        ...extraClient,
      };
    }

    it('should publish inbound DM messages when allowlisted', async () => {
      await adapter.initialize(mockConfig);

      const mockRoom = {
        getJoinedMembers: () => [{ userId: '@bot:example.com' }, { userId: '@alice:example.com' }],
        getMember: (userId: string) => (userId === '@alice:example.com' ? { name: 'Alice' } : null),
      };
      patchClient(adapter, mockRoom);

      const event = createMatrixEvent({
        sender: '@alice:example.com',
        content: { msgtype: 'm.text', body: 'Hello from DM' },
      });

      await callHandleTimelineEvent(adapter, event);

      expect(mockBus.publish).toHaveBeenCalledWith(
        'nachos.channel.matrix.inbound',
        expect.objectContaining({
          channel: 'matrix',
          sender: expect.objectContaining({
            id: '@alice:example.com',
            name: 'Alice',
          }),
          conversation: expect.objectContaining({
            id: '!room1:example.com',
            type: 'dm',
          }),
          content: expect.objectContaining({
            text: 'Hello from DM',
          }),
        })
      );
    });

    it('should ignore messages from the bot itself', async () => {
      await adapter.initialize(mockConfig);

      const event = createMatrixEvent({
        sender: '@bot:example.com',
      });

      await callHandleTimelineEvent(adapter, event);

      expect(mockBus.publish).not.toHaveBeenCalled();
    });

    it('should ignore non-message events', async () => {
      await adapter.initialize(mockConfig);

      const event = createMatrixEvent({
        type: 'm.room.member',
      });

      await callHandleTimelineEvent(adapter, event);

      expect(mockBus.publish).not.toHaveBeenCalled();
    });

    it('should drop DMs from non-allowlisted users', async () => {
      await adapter.initialize(mockConfig);

      const mockRoom = {
        getJoinedMembers: () => [
          { userId: '@bot:example.com' },
          { userId: '@stranger:example.com' },
        ],
        getMember: () => null,
      };
      patchClient(adapter, mockRoom);

      const event = createMatrixEvent({
        sender: '@stranger:example.com',
      });

      await callHandleTimelineEvent(adapter, event);

      expect(mockBus.publish).not.toHaveBeenCalled();
    });

    it('should publish channel messages when server config matches', async () => {
      const configWithServers: ChannelAdapterConfig = {
        ...mockConfig,
        config: {
          ...mockConfig.config,
          servers: [
            {
              ids: ['!room1:example.com'],
              channel_ids: ['!room1:example.com'],
              user_allowlist: ['@alice:example.com'],
              mention_gating: false,
            },
          ],
        },
      };

      await adapter.initialize(configWithServers);

      // Mock a room with 3+ members (not a DM)
      const mockRoom = {
        getJoinedMembers: () => [
          { userId: '@bot:example.com' },
          { userId: '@alice:example.com' },
          { userId: '@bob:example.com' },
        ],
        getMember: () => ({ name: 'Alice' }),
      };
      patchClient(adapter, mockRoom);

      const event = createMatrixEvent({
        sender: '@alice:example.com',
        content: { msgtype: 'm.text', body: 'Hello room' },
      });

      await callHandleTimelineEvent(adapter, event);

      expect(mockBus.publish).toHaveBeenCalledWith(
        'nachos.channel.matrix.inbound',
        expect.objectContaining({
          conversation: expect.objectContaining({
            id: '!room1:example.com',
            type: 'channel',
          }),
          content: expect.objectContaining({
            text: 'Hello room',
          }),
        })
      );
    });

    it('should drop channel messages without matching server config', async () => {
      await adapter.initialize(mockConfig);

      // Mock a room with 3+ members (not a DM) -- no server config
      const mockRoom = {
        getJoinedMembers: () => [
          { userId: '@bot:example.com' },
          { userId: '@alice:example.com' },
          { userId: '@bob:example.com' },
        ],
        getMember: () => null,
      };
      patchClient(adapter, mockRoom);

      const event = createMatrixEvent();

      await callHandleTimelineEvent(adapter, event);

      expect(mockBus.publish).not.toHaveBeenCalled();
    });

    it('should handle image attachments from inbound messages', async () => {
      await adapter.initialize(mockConfig);

      const mockRoom = {
        getJoinedMembers: () => [{ userId: '@bot:example.com' }, { userId: '@alice:example.com' }],
        getMember: () => ({ name: 'Alice' }),
      };
      patchClient(adapter, mockRoom, {
        mxcUrlToHttp: (mxc: string) =>
          mxc === 'mxc://example.com/image1'
            ? 'https://matrix.example.com/_matrix/media/v3/download/example.com/image1'
            : null,
      });

      const event = createMatrixEvent({
        sender: '@alice:example.com',
        content: {
          msgtype: 'm.image',
          body: 'photo.png',
          url: 'mxc://example.com/image1',
          info: { mimetype: 'image/png', size: 12345 },
        },
      });

      await callHandleTimelineEvent(adapter, event);

      expect(mockBus.publish).toHaveBeenCalledWith(
        'nachos.channel.matrix.inbound',
        expect.objectContaining({
          content: expect.objectContaining({
            text: 'photo.png',
            attachments: [
              expect.objectContaining({
                type: 'image',
                url: 'https://matrix.example.com/_matrix/media/v3/download/example.com/image1',
                name: 'photo.png',
                mimeType: 'image/png',
                size: 12345,
              }),
            ],
          }),
        })
      );
    });

    it('should handle file attachments from inbound messages', async () => {
      await adapter.initialize(mockConfig);

      const mockRoom = {
        getJoinedMembers: () => [{ userId: '@bot:example.com' }, { userId: '@alice:example.com' }],
        getMember: () => ({ name: 'Alice' }),
      };
      patchClient(adapter, mockRoom, {
        mxcUrlToHttp: () => 'https://matrix.example.com/_matrix/media/v3/download/example.com/doc1',
      });

      const event = createMatrixEvent({
        sender: '@alice:example.com',
        content: {
          msgtype: 'm.file',
          body: 'document.pdf',
          url: 'mxc://example.com/doc1',
          info: { mimetype: 'application/pdf', size: 99999 },
        },
      });

      await callHandleTimelineEvent(adapter, event);

      expect(mockBus.publish).toHaveBeenCalledWith(
        'nachos.channel.matrix.inbound',
        expect.objectContaining({
          content: expect.objectContaining({
            attachments: [
              expect.objectContaining({
                type: 'file',
                name: 'document.pdf',
                mimeType: 'application/pdf',
              }),
            ],
          }),
        })
      );
    });

    it('should handle audio attachments from inbound messages', async () => {
      await adapter.initialize(mockConfig);

      const mockRoom = {
        getJoinedMembers: () => [{ userId: '@bot:example.com' }, { userId: '@alice:example.com' }],
        getMember: () => ({ name: 'Alice' }),
      };
      patchClient(adapter, mockRoom, {
        mxcUrlToHttp: () =>
          'https://matrix.example.com/_matrix/media/v3/download/example.com/audio1',
      });

      const event = createMatrixEvent({
        sender: '@alice:example.com',
        content: {
          msgtype: 'm.audio',
          body: 'recording.mp3',
          url: 'mxc://example.com/audio1',
          info: { mimetype: 'audio/mpeg', size: 50000 },
        },
      });

      await callHandleTimelineEvent(adapter, event);

      expect(mockBus.publish).toHaveBeenCalledWith(
        'nachos.channel.matrix.inbound',
        expect.objectContaining({
          content: expect.objectContaining({
            attachments: [
              expect.objectContaining({
                type: 'file',
                name: 'recording.mp3',
                mimeType: 'audio/mpeg',
              }),
            ],
          }),
        })
      );
    });

    it('should ignore unsupported message types', async () => {
      await adapter.initialize(mockConfig);

      const mockRoom = {
        getJoinedMembers: () => [{ userId: '@bot:example.com' }, { userId: '@alice:example.com' }],
        getMember: () => null,
      };
      patchClient(adapter, mockRoom);

      const event = createMatrixEvent({
        sender: '@alice:example.com',
        content: { msgtype: 'm.location', body: 'some location' },
      });

      await callHandleTimelineEvent(adapter, event);

      expect(mockBus.publish).not.toHaveBeenCalled();
    });

    it('should ignore events with no sender', async () => {
      await adapter.initialize(mockConfig);

      const event = {
        getSender: () => null,
        getType: () => 'm.room.message',
        getRoomId: () => '!room1:example.com',
        getId: () => '$event1',
        getContent: () => ({ msgtype: 'm.text', body: 'test' }),
        getTs: () => Date.now(),
      };

      await callHandleTimelineEvent(adapter, event);

      expect(mockBus.publish).not.toHaveBeenCalled();
    });

    it('should ignore events with no roomId', async () => {
      await adapter.initialize(mockConfig);

      const event = {
        getSender: () => '@alice:example.com',
        getType: () => 'm.room.message',
        getRoomId: () => null,
        getId: () => '$event1',
        getContent: () => ({ msgtype: 'm.text', body: 'test' }),
        getTs: () => Date.now(),
      };

      await callHandleTimelineEvent(adapter, event);

      expect(mockBus.publish).not.toHaveBeenCalled();
    });

    it('should handle notice messages', async () => {
      await adapter.initialize(mockConfig);

      const mockRoom = {
        getJoinedMembers: () => [{ userId: '@bot:example.com' }, { userId: '@alice:example.com' }],
        getMember: () => ({ name: 'Alice' }),
      };
      patchClient(adapter, mockRoom);

      const event = createMatrixEvent({
        sender: '@alice:example.com',
        content: { msgtype: 'm.notice', body: 'A notice message' },
      });

      await callHandleTimelineEvent(adapter, event);

      expect(mockBus.publish).toHaveBeenCalledWith(
        'nachos.channel.matrix.inbound',
        expect.objectContaining({
          content: expect.objectContaining({
            text: 'A notice message',
          }),
        })
      );
    });
  });

  describe('markdownToHtml', () => {
    function convert(md: string): string {
      return (adapter as unknown as { markdownToHtml: (md: string) => string }).markdownToHtml.call(
        adapter,
        md
      );
    }

    it('should convert bold text', () => {
      expect(convert('**bold**')).toContain('<strong>bold</strong>');
    });

    it('should convert code blocks', () => {
      const result = convert('```js\nconsole.log("hi");\n```');
      expect(result).toContain('<pre><code class="language-js">');
      expect(result).toContain('console.log(&quot;hi&quot;);');
    });

    it('should convert inline code', () => {
      expect(convert('use `npm install`')).toContain('<code>npm install</code>');
    });

    it('should convert strikethrough', () => {
      expect(convert('~~deleted~~')).toContain('<del>deleted</del>');
    });

    it('should convert line breaks', () => {
      expect(convert('line1\nline2')).toContain('line1<br/>line2');
    });
  });

  describe('helper methods', () => {
    it('guessContentType returns correct MIME types', () => {
      const guess = (
        adapter as unknown as { guessContentType: (name: string) => string }
      ).guessContentType.bind(adapter);
      expect(guess('photo.png')).toBe('image/png');
      expect(guess('doc.pdf')).toBe('application/pdf');
      expect(guess('song.mp3')).toBe('audio/mpeg');
      expect(guess('unknown.xyz')).toBe('application/octet-stream');
    });

    it('decodeAttachmentData handles base64 data URIs', () => {
      const decode = (
        adapter as unknown as { decodeAttachmentData: (data: string) => Buffer | null }
      ).decodeAttachmentData.bind(adapter);
      const encoded = `data:text/plain;base64,${Buffer.from('hello').toString('base64')}`;
      const result = decode(encoded);
      expect(result).not.toBeNull();
      expect(result!.toString()).toBe('hello');
    });

    it('decodeAttachmentData handles raw base64', () => {
      const decode = (
        adapter as unknown as { decodeAttachmentData: (data: string) => Buffer | null }
      ).decodeAttachmentData.bind(adapter);
      const result = decode(Buffer.from('hello').toString('base64'));
      expect(result).not.toBeNull();
      expect(result!.toString()).toBe('hello');
    });

    it('decodeAttachmentData returns null for non-base64 strings', () => {
      const decode = (
        adapter as unknown as { decodeAttachmentData: (data: string) => Buffer | null }
      ).decodeAttachmentData.bind(adapter);
      const result = decode('not base64!!!');
      expect(result).toBeNull();
    });

    it('isDirectMessage returns true for 2-member rooms', () => {
      const isDm = (
        adapter as unknown as { isDirectMessage: (room: unknown) => boolean }
      ).isDirectMessage.bind(adapter);
      const room = {
        getJoinedMembers: () => [{ userId: '@a' }, { userId: '@b' }],
      };
      expect(isDm(room)).toBe(true);
    });

    it('isDirectMessage returns false for 3+ member rooms', () => {
      const isDm = (
        adapter as unknown as { isDirectMessage: (room: unknown) => boolean }
      ).isDirectMessage.bind(adapter);
      const room = {
        getJoinedMembers: () => [{ userId: '@a' }, { userId: '@b' }, { userId: '@c' }],
      };
      expect(isDm(room)).toBe(false);
    });
  });
});

describe('applyEnvBridge', () => {
  afterEach(() => {
    delete process.env.MATRIX_HOMESERVER_URL;
    delete process.env.MATRIX_ACCESS_TOKEN;
    delete process.env.MATRIX_USER_ID;
    delete process.env.MATRIX_DEVICE_ID;
    delete process.env.CHANNEL_MATRIX_ROOM_IDS;
    delete process.env.CHANNEL_MATRIX_CHANNEL_IDS;
    delete process.env.CHANNEL_MATRIX_USER_ALLOWLIST;
    delete process.env.CHANNEL_MATRIX_MENTION_GATING;
    delete process.env.CHANNEL_MATRIX_DM_ALLOWLIST;
  });

  it('should inject homeserver from env when not in config', () => {
    process.env.MATRIX_HOMESERVER_URL = 'https://matrix.org';
    const config: Record<string, unknown> = {};
    applyEnvBridge(config);
    expect(config.homeserver_url).toBe('https://matrix.org');
  });

  it('should not override TOML config with env', () => {
    process.env.MATRIX_HOMESERVER_URL = 'https://env.org';
    const config: Record<string, unknown> = { homeserver_url: 'https://toml.org' };
    applyEnvBridge(config);
    expect(config.homeserver_url).toBe('https://toml.org');
  });

  it('should build server config from env vars', () => {
    process.env.CHANNEL_MATRIX_ROOM_IDS = '!room1:example.com,!room2:example.com';
    process.env.CHANNEL_MATRIX_CHANNEL_IDS = '!room1:example.com';
    process.env.CHANNEL_MATRIX_USER_ALLOWLIST = '@alice:example.com,@bob:example.com';
    const config: Record<string, unknown> = {};
    applyEnvBridge(config);
    expect(config.servers).toEqual([
      {
        ids: ['!room1:example.com', '!room2:example.com'],
        channel_ids: ['!room1:example.com'],
        user_allowlist: ['@alice:example.com', '@bob:example.com'],
        mention_gating: true,
      },
    ]);
  });

  it('should not build servers when TOML has servers', () => {
    process.env.CHANNEL_MATRIX_ROOM_IDS = '!room1:example.com';
    const existing = [{ ids: ['!existing:example.com'], channel_ids: [], user_allowlist: [] }];
    const config: Record<string, unknown> = { servers: existing };
    applyEnvBridge(config);
    expect(config.servers).toBe(existing);
  });

  it('should build DM allowlist from env var', () => {
    process.env.CHANNEL_MATRIX_DM_ALLOWLIST = '@alice:example.com,@bob:example.com';
    const config: Record<string, unknown> = {};
    applyEnvBridge(config);
    expect(config.dm).toEqual({
      user_allowlist: ['@alice:example.com', '@bob:example.com'],
    });
  });

  it('should inject access_token and user_id from env', () => {
    process.env.MATRIX_ACCESS_TOKEN = 'env-token';
    process.env.MATRIX_USER_ID = '@env:example.com';
    const config: Record<string, unknown> = {};
    applyEnvBridge(config);
    expect(config.access_token).toBe('env-token');
    expect(config.user_id).toBe('@env:example.com');
  });

  it('should inject device_id from env when not in config', () => {
    process.env.MATRIX_DEVICE_ID = 'DEV123';
    const config: Record<string, unknown> = {};
    applyEnvBridge(config);
    expect(config.device_id).toBe('DEV123');
  });
});
