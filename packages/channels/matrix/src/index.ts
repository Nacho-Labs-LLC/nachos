/**
 * Matrix Channel Adapter for Nachos
 *
 * Integrates Matrix protocol support for decentralized chat.
 * Supports:
 * - Direct messages (DMs)
 * - Rooms (channels)
 * - Text messages (plain and markdown/HTML)
 * - File/media attachments (inbound and outbound)
 * - Typing indicators
 * - Pairing-based DM access
 * - Auto-join on invite
 * - Reconnection resilience
 */

import * as sdk from 'matrix-js-sdk';
import type { ChannelDMConfig, ChannelServerConfig } from '@nachos/config';
import type {
  ChannelAdapter,
  ChannelAdapterConfig,
  OutboundMessage,
  SendResult,
  HealthStatusType,
} from '@nachos/types';
import {
  createLogger,
  createConfigError,
  createInvalidStateError,
  validateChannelInboundMessage,
} from '@nachos/types';
import {
  TOPICS,
  resolveDmPolicy,
  resolveGroupPolicy,
  findServerConfig,
  createPairingStore,
  parsePairingCommand,
} from '@nachos/channel-base';
import { shouldAllowDm, shouldAllowGroupMessage } from '@nachos/utils';

const logger = createLogger('matrix-channel');

/**
 * Matrix channel configuration shape.
 * Mirrors the MatrixChannelConfig from @nachos/config schema.
 */
interface MatrixChannelConfig {
  enabled?: boolean;
  homeserver_url?: string;
  access_token?: string;
  user_id?: string;
  device_id?: string;
  dm?: ChannelDMConfig;
  servers?: ChannelServerConfig[];
}

interface StatusEvent {
  sessionId: string;
  status: 'thinking' | 'tool' | 'done' | 'error';
  channelId: string;
  channelMessageId?: string;
  toolName?: string;
}

export class MatrixChannelAdapter implements ChannelAdapter {
  readonly channelId = 'matrix';
  readonly name = 'Matrix';

  private config?: ChannelAdapterConfig;
  private client?: sdk.MatrixClient;
  private matrixConfig?: MatrixChannelConfig;
  private botUserId?: string;
  private isRunning = false;
  private typingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private pairingStore = createPairingStore('matrix', {
    stateDir: process.env.RUNTIME_STATE_DIR ?? process.env.NACHOS_STATE_DIR,
  });
  private pairingToken = process.env.NACHOS_PAIRING_TOKEN;

  async initialize(config: ChannelAdapterConfig): Promise<void> {
    this.config = config;
    this.matrixConfig = (config.config ?? {}) as unknown as MatrixChannelConfig;

    const homeserver =
      this.matrixConfig.homeserver_url ?? (config.secrets.MATRIX_HOMESERVER_URL as string);
    const accessToken =
      this.matrixConfig.access_token ?? (config.secrets.MATRIX_ACCESS_TOKEN as string);
    const userId = this.matrixConfig.user_id ?? (config.secrets.MATRIX_USER_ID as string);

    if (!homeserver) {
      throw createConfigError('Matrix homeserver URL is required', {
        component: 'matrix-channel',
      });
    }
    if (!accessToken) {
      throw createConfigError('Matrix access token is required', {
        component: 'matrix-channel',
      });
    }
    if (!userId) {
      throw createConfigError('Matrix user ID is required', { component: 'matrix-channel' });
    }

    // Store resolved credentials for internal use
    this.botUserId = userId;

    // Create Matrix client
    this.client = sdk.createClient({
      baseUrl: homeserver,
      accessToken,
      userId,
      deviceId: this.matrixConfig.device_id,
      timelineSupport: true,
    });

    // Set up event handlers
    this.client.on(sdk.RoomEvent.Timeline, (event: sdk.MatrixEvent) => {
      void this.handleTimelineEvent(event);
    });

    // Auto-join rooms when invited
    this.client.on(
      sdk.RoomMemberEvent.Membership,
      (_event: sdk.MatrixEvent, member: sdk.RoomMember) => {
        if (member.membership === 'invite' && member.userId === this.botUserId) {
          void this.handleInvite(member.roomId);
        }
      }
    );

    logger.info({ userId, homeserver }, 'Matrix adapter initialized');
  }

  async start(): Promise<void> {
    if (!this.client || !this.config) {
      throw createInvalidStateError('Matrix adapter not initialized', {
        component: 'matrix-channel',
      });
    }

    // Start the Matrix client sync
    await this.client.startClient({ initialSyncLimit: 10 });
    this.isRunning = true;

    logger.info('Matrix client sync started');

    // Subscribe to outbound messages from gateway
    await this.config.bus.subscribe(TOPICS.channel.outbound(this.channelId), async (payload) => {
      await this.sendMessage(payload as OutboundMessage);
    });

    // Subscribe to status events for typing indicators
    await this.subscribeToStatusEvents();
  }

  async stop(): Promise<void> {
    // Clean up all typing intervals
    for (const interval of this.typingIntervals.values()) {
      clearInterval(interval);
    }
    this.typingIntervals.clear();

    if (this.client) {
      this.client.stopClient();
      this.isRunning = false;
      logger.info('Matrix client stopped');
    }
  }

  private async subscribeToStatusEvents(): Promise<void> {
    if (!this.config) return;

    const handler = async (event: unknown) => this.handleStatusEvent(event as StatusEvent);
    await this.config.bus.subscribe(TOPICS.status.thinking('*'), handler);
    await this.config.bus.subscribe(TOPICS.status.tool('*'), handler);
    await this.config.bus.subscribe(TOPICS.status.done('*'), handler);
    await this.config.bus.subscribe(TOPICS.status.error('*'), handler);
  }

  private async handleStatusEvent(event: StatusEvent): Promise<void> {
    if (!event.channelId || !this.client) return;

    await this.handleTypingIndicator(event);
  }

  private async handleTypingIndicator(event: StatusEvent): Promise<void> {
    if (!this.client || !event.channelId) return;

    const roomId = event.channelId;

    if (event.status === 'thinking' || event.status === 'tool') {
      await this.startTypingIndicator(roomId);
    } else if (event.status === 'done' || event.status === 'error') {
      await this.stopTypingIndicator(roomId);
    }
  }

  private async startTypingIndicator(roomId: string): Promise<void> {
    if (!this.client) return;

    // If already typing, don't restart
    if (this.typingIntervals.has(roomId)) return;

    // Send initial typing indicator
    await this.sendTyping(roomId, true);

    // Matrix typing indicators last ~30s, refresh every 25s
    const interval = setInterval(() => {
      void this.sendTyping(roomId, true);
    }, 25000);

    this.typingIntervals.set(roomId, interval);
  }

  private async stopTypingIndicator(roomId: string): Promise<void> {
    const interval = this.typingIntervals.get(roomId);
    if (interval) {
      clearInterval(interval);
      this.typingIntervals.delete(roomId);
    }

    // Explicitly stop typing
    await this.sendTyping(roomId, false);
  }

  private async sendTyping(roomId: string, isTyping: boolean): Promise<void> {
    if (!this.client) return;

    try {
      await this.client.sendTyping(roomId, isTyping, isTyping ? 30000 : 0);
    } catch (error) {
      // Gracefully handle errors (permissions, left room, etc.)
      const existingInterval = this.typingIntervals.get(roomId);
      if (existingInterval) {
        clearInterval(existingInterval);
        this.typingIntervals.delete(roomId);
      }
      logger.warn({ roomId, err: error }, 'Failed to send typing indicator');
    }
  }

  private async handleInvite(roomId: string): Promise<void> {
    if (!this.client) return;

    try {
      await this.client.joinRoom(roomId);
      logger.info({ roomId }, 'Auto-joined room on invite');
    } catch (error) {
      logger.warn({ roomId, err: error }, 'Failed to auto-join room');
    }
  }

  private async handleTimelineEvent(event: sdk.MatrixEvent): Promise<void> {
    if (!this.config || !this.matrixConfig) return;

    const senderId = event.getSender();
    if (!senderId) return;

    // Ignore events from the bot itself
    if (senderId === this.botUserId) return;

    // Only process room messages
    if (event.getType() !== 'm.room.message') return;

    const content = event.getContent();
    const roomId = event.getRoomId();
    if (!roomId) return;
    const eventId = event.getId();
    if (!eventId) return;

    // Determine if this is a DM or room message
    const room = this.client?.getRoom(roomId);
    if (!room) return;

    const isDm = this.isDirectMessage(room);
    const conversationType = isDm ? 'dm' : 'channel';

    // Process message text (handle text, notice, and emote types)
    const msgtype = content.msgtype as string;
    let messageText = '';
    const attachments: Array<{
      type: string;
      url: string;
      name?: string;
      mimeType?: string;
      size?: number;
    }> = [];

    if (msgtype === 'm.text' || msgtype === 'm.notice' || msgtype === 'm.emote') {
      messageText = (content.body as string) ?? '';
    } else if (
      msgtype === 'm.image' ||
      msgtype === 'm.file' ||
      msgtype === 'm.audio' ||
      msgtype === 'm.video'
    ) {
      // File/media message
      messageText = (content.body as string) ?? '';
      const mxcUrl = content.url as string | undefined;
      if (mxcUrl && this.client) {
        const httpUrl = this.mxcToHttp(mxcUrl);
        if (httpUrl) {
          const info = content.info as { mimetype?: string; size?: number } | undefined;
          attachments.push({
            type: msgtype === 'm.image' ? 'image' : 'file',
            url: httpUrl,
            name: (content.body as string) ?? 'attachment',
            mimeType: info?.mimetype,
            size: info?.size,
          });
        }
      }
    } else {
      // Unsupported message type, skip
      return;
    }

    // Check DM policy
    if (isDm) {
      const dmPolicy = resolveDmPolicy(this.matrixConfig.dm) ?? this.config.dmPolicy;
      if (!dmPolicy) return;

      // Handle pairing command
      if (dmPolicy.pairing) {
        const command = parsePairingCommand(messageText);
        if (command) {
          if (this.pairingToken && command.token !== this.pairingToken) {
            await this.sendMessage({
              channel: this.channelId,
              conversationId: roomId,
              content: { text: 'Pairing token invalid.' },
            });
            return;
          }
          await this.pairingStore.setPaired(senderId);
          await this.sendMessage({
            channel: this.channelId,
            conversationId: roomId,
            content: { text: 'Pairing successful. You can now message the assistant.' },
          });
          return;
        }
      }

      const allowed = await shouldAllowDm(
        senderId,
        dmPolicy.userAllowlist,
        dmPolicy.pairing ?? false,
        async (id) => this.pairingStore.isPaired(id)
      );
      if (!allowed) return;
    }

    // Check group policy
    if (!isDm) {
      const serverConfig = findServerConfig(this.matrixConfig.servers, roomId);
      if (!serverConfig) return;
      const groupPolicy = resolveGroupPolicy(serverConfig);

      const mentionPatterns = this.botUserId ? [this.botUserId] : [];
      const allowed = shouldAllowGroupMessage({
        channelId: roomId,
        userId: senderId,
        text: messageText,
        channelAllowlist: groupPolicy.channelIds,
        userAllowlist: groupPolicy.userAllowlist,
        mentionGating: groupPolicy.mentionGating,
        mentionPatterns,
      });
      if (!allowed) return;
    }

    // Build and validate inbound message
    const inboundMessage = {
      channel: this.channelId,
      channelMessageId: eventId,
      sender: {
        id: senderId,
        name: this.getUserDisplayName(senderId, room),
        isAllowed: true,
      },
      conversation: {
        id: roomId,
        type: conversationType,
      },
      content: {
        text: messageText,
        ...(attachments.length > 0 ? { attachments } : {}),
      },
      metadata: {
        roomId,
        eventId,
        timestamp: event.getTs(),
      },
    };

    const validation = validateChannelInboundMessage(inboundMessage);
    if (!validation.success) {
      logger.warn({ errors: validation.errors }, 'Dropping invalid inbound message');
      return;
    }

    await this.config.bus.publish(TOPICS.channel.inbound(this.channelId), inboundMessage);
  }

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    if (!this.client) {
      return {
        success: false,
        error: {
          code: 'CLIENT_NOT_INITIALIZED',
          message: 'Matrix client not initialized',
          retryable: false,
        },
      };
    }

    try {
      const roomId = message.conversationId;
      const text = message.content.text;

      // Send the text message
      const response =
        message.content.format === 'markdown'
          ? await this.client.sendHtmlMessage(roomId, text, this.markdownToHtml(text))
          : await this.client.sendTextMessage(roomId, text);

      // Handle outbound attachments
      const attachments = message.content.attachments ?? [];
      for (let i = 0; i < attachments.length; i += 1) {
        const attachment = attachments[i];
        if (!attachment) continue;

        try {
          await this.sendAttachment(roomId, attachment, i);
        } catch (attachError) {
          logger.warn(
            { roomId, attachmentIndex: i, err: attachError },
            'Failed to send attachment'
          );
        }
      }

      return {
        success: true,
        messageId: response.event_id,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        { conversationId: message.conversationId, err: error },
        'Failed to send message'
      );
      return {
        success: false,
        error: {
          code: 'SEND_FAILED',
          message: errorMessage,
          retryable: true,
        },
      };
    }
  }

  private async sendAttachment(
    roomId: string,
    attachment: { type: string; data?: unknown; name?: string },
    index: number
  ): Promise<void> {
    if (!this.client) return;

    const data = attachment.data;
    if (!data) return;

    let buffer: Buffer | null = null;
    if (typeof data === 'string') {
      buffer = this.decodeAttachmentData(data);
    } else if (data instanceof Uint8Array) {
      buffer = Buffer.from(data);
    }

    if (!buffer) {
      // If data is a URL string, send it as a text message with the link
      if (typeof data === 'string' && this.isUrl(data)) {
        await this.client.sendTextMessage(roomId, `Attachment: ${data}`);
      }
      return;
    }

    const filename = attachment.name ?? `attachment-${index + 1}`;
    const contentType = this.guessContentType(filename);

    // Upload the content to the Matrix homeserver.
    // Convert Buffer to ArrayBuffer then to Blob for the matrix-js-sdk FileType.
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
    const uploadResponse = await this.client.uploadContent(new Blob([arrayBuffer]), {
      name: filename,
      type: contentType,
    });

    const mxcUrl = typeof uploadResponse === 'string' ? uploadResponse : uploadResponse.content_uri;

    // Send as a file or image message.
    // Use sendHtmlMessage trick: call sendMessage with file content cast through unknown
    // because RoomMessageEventContent is a complex union not directly constructible.
    const fileContent = {
      msgtype: attachment.type === 'image' ? 'm.image' : 'm.file',
      body: filename,
      url: mxcUrl,
      info: {
        size: buffer.length,
        mimetype: contentType,
      },
    };

    await (this.client.sendMessage as (...args: unknown[]) => Promise<unknown>)(
      roomId,
      fileContent
    );
  }

  async healthCheck(): Promise<HealthStatusType> {
    if (!this.client || !this.isRunning) {
      return 'unhealthy';
    }

    try {
      const syncState = this.client.getSyncState();
      if (syncState === 'SYNCING' || syncState === 'PREPARED') {
        return 'healthy';
      }
      return 'degraded';
    } catch {
      return 'unhealthy';
    }
  }

  // ── Helper methods ──────────────────────────────────────────────────────

  private isDirectMessage(room: sdk.Room): boolean {
    // Matrix DMs are typically rooms with exactly 2 joined members (bot + user)
    const members = room.getJoinedMembers();
    return members.length === 2;
  }

  private getUserDisplayName(userId: string, room?: sdk.Room): string {
    if (!this.client) return userId;

    try {
      // Prefer room-level display name (room member state)
      if (room) {
        const member = room.getMember(userId);
        if (member?.name) return member.name;
      }

      // Fall back to global user profile
      const user = this.client.getUser(userId);
      return user?.displayName ?? userId;
    } catch {
      return userId;
    }
  }

  private mxcToHttp(mxcUrl: string): string | null {
    if (!this.client || !mxcUrl.startsWith('mxc://')) return null;

    try {
      return this.client.mxcUrlToHttp(mxcUrl) ?? null;
    } catch {
      return null;
    }
  }

  private markdownToHtml(markdown: string): string {
    let html = markdown;

    // Code blocks (must be before inline code)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang: string, code: string) => {
      const langAttr = lang ? ` class="language-${lang}"` : '';
      return `<pre><code${langAttr}>${this.escapeHtml(code)}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');

    // Strikethrough
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // Line breaks
    html = html.replace(/\n/g, '<br/>');

    return html;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private decodeAttachmentData(data: string): Buffer | null {
    if (data.startsWith('data:')) {
      const base64Index = data.indexOf('base64,');
      if (base64Index !== -1) {
        const base64 = data.slice(base64Index + 7);
        try {
          return Buffer.from(base64, 'base64');
        } catch {
          return null;
        }
      }
      return null;
    }

    if (this.looksLikeBase64(data)) {
      try {
        return Buffer.from(data, 'base64');
      } catch {
        return null;
      }
    }

    return null;
  }

  private looksLikeBase64(data: string): boolean {
    return /^[A-Za-z0-9+/=]+$/.test(data) && data.length % 4 === 0 && data.length > 0;
  }

  private isUrl(value: string): boolean {
    return value.startsWith('http://') || value.startsWith('https://');
  }

  private guessContentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
      txt: 'text/plain',
      json: 'application/json',
      mp3: 'audio/mpeg',
      mp4: 'video/mp4',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      webm: 'video/webm',
    };
    return mimeTypes[ext ?? ''] ?? 'application/octet-stream';
  }
}
