import { Telegraf } from 'telegraf';
import type { TelegramChannelConfig } from '@nachos/config';
import {
  TOPICS,
  findServerConfig,
  resolveDmPolicy,
  resolveGroupPolicy,
  createPairingStore,
  parsePairingCommand,
} from '@nachos/channel-base';
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
import { shouldAllowDm, shouldAllowGroupMessage } from '@nachos/utils';

const logger = createLogger('telegram-channel');

/** Maps Telegram media type to a human-readable attachment type string. */
const MEDIA_TYPE_MAP: Record<string, string> = {
  photo: 'image',
  document: 'file',
  video: 'video',
  audio: 'audio',
  voice: 'audio',
  sticker: 'image',
};

interface StatusEvent {
  sessionId: string;
  status: 'thinking' | 'tool' | 'done' | 'error';
  channelId: string;
  channelMessageId?: string;
  toolName?: string;
}

export class TelegramChannelAdapter implements ChannelAdapter {
  readonly channelId = 'telegram';
  readonly name = 'Telegram';

  private config?: ChannelAdapterConfig;
  private bot?: Telegraf;
  private botUsername?: string;
  private pairingStore = createPairingStore('telegram', {
    stateDir: process.env.RUNTIME_STATE_DIR ?? process.env.NACHOS_STATE_DIR,
  });
  private pairingToken = process.env.NACHOS_PAIRING_TOKEN;
  private typingIntervals: Map<string, NodeJS.Timeout> = new Map();

  async initialize(config: ChannelAdapterConfig): Promise<void> {
    this.config = config;
    const channelConfig = config.config as TelegramChannelConfig;
    const token = channelConfig.token ?? config.secrets.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw createConfigError('Telegram token is required', { component: 'telegram-channel' });
    }

    this.bot = new Telegraf(token);

    // Text messages
    this.bot.on('text', async (ctx) => {
      await this.handleMessage(ctx);
    });

    // Media message handlers
    this.bot.on('photo', async (ctx) => {
      await this.handleMediaMessage(ctx, 'photo');
    });
    this.bot.on('document', async (ctx) => {
      await this.handleMediaMessage(ctx, 'document');
    });
    this.bot.on('video', async (ctx) => {
      await this.handleMediaMessage(ctx, 'video');
    });
    this.bot.on('audio', async (ctx) => {
      await this.handleMediaMessage(ctx, 'audio');
    });
    this.bot.on('voice', async (ctx) => {
      await this.handleMediaMessage(ctx, 'voice');
    });
    this.bot.on('sticker', async (ctx) => {
      await this.handleMediaMessage(ctx, 'sticker');
    });
  }

  async start(): Promise<void> {
    if (!this.bot || !this.config) {
      throw createInvalidStateError('Telegram adapter not initialized', {
        component: 'telegram-channel',
      });
    }

    const me = await this.bot.telegram.getMe();
    this.botUsername = me.username ?? undefined;

    await this.bot.launch();

    await this.config.bus.subscribe(TOPICS.channel.outbound(this.channelId), async (payload) => {
      await this.sendMessage(payload as OutboundMessage);
    });

    // Subscribe to status events for typing indicators
    await this.subscribeToStatusEvents();
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
    if (!event.channelId || !this.bot) return;

    if (event.status === 'thinking' || event.status === 'tool') {
      await this.startTypingIndicator(event.channelId);
    } else if (event.status === 'done' || event.status === 'error') {
      this.stopTypingIndicator(event.channelId);
    }
  }

  private async startTypingIndicator(chatId: string): Promise<void> {
    if (!this.bot) return;
    if (this.typingIntervals.has(chatId)) return;

    await this.sendTypingAction(chatId);

    // Telegram typing indicator lasts ~5 seconds; refresh every 4 seconds
    const interval = setInterval(() => {
      void this.sendTypingAction(chatId);
    }, 4000);

    this.typingIntervals.set(chatId, interval);
  }

  private stopTypingIndicator(chatId: string): void {
    const interval = this.typingIntervals.get(chatId);
    if (interval) {
      clearInterval(interval);
      this.typingIntervals.delete(chatId);
    }
  }

  private async sendTypingAction(chatId: string): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.telegram.sendChatAction(Number(chatId), 'typing');
    } catch (error) {
      this.stopTypingIndicator(chatId);
      logger.warn({ chatId, err: error }, 'Failed to send typing indicator');
    }
  }

  async stop(): Promise<void> {
    // Clean up all typing intervals
    for (const interval of this.typingIntervals.values()) {
      clearInterval(interval);
    }
    this.typingIntervals.clear();

    await this.bot?.stop();
  }

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    if (!this.bot) {
      throw createInvalidStateError('Telegram adapter not initialized', {
        component: 'telegram-channel',
      });
    }

    try {
      const chatId = Number(message.conversationId);

      // Send typing indicator before replying
      await this.bot.telegram.sendChatAction(chatId, 'typing').catch(() => {
        // Non-fatal: best-effort typing indicator
      });

      const replyOptions = message.replyToMessageId
        ? ({ reply_to_message_id: Number(message.replyToMessageId) } as unknown as Parameters<
            typeof this.bot.telegram.sendMessage
          >[2])
        : undefined;

      // Send text message
      const response = await this.bot.telegram.sendMessage(
        chatId,
        message.content.text,
        replyOptions
      );

      // Send any file attachments
      const attachments = message.content.attachments ?? [];
      for (const attachment of attachments) {
        if (!attachment) continue;
        await this.sendOutboundAttachment(chatId, attachment, message.replyToMessageId);
      }

      return {
        success: true,
        messageId: String(response.message_id),
      };
    } catch (error) {
      const err = error as Error & { code?: string };
      return {
        success: false,
        error: {
          code: err.code ?? 'telegram_error',
          message: err.message,
          retryable: true,
        },
      };
    }
  }

  /**
   * Send an outbound attachment as a Telegram document or photo.
   */
  private async sendOutboundAttachment(
    chatId: number,
    attachment: { type: string; data: unknown; name?: string },
    replyToMessageId?: string
  ): Promise<void> {
    if (!this.bot) return;

    // Telegraf typing for extras doesn't expose reply_to_message_id directly,
    // so cast through unknown just like the original sendMessage does.
    const replyExtra = replyToMessageId
      ? ({ reply_to_message_id: Number(replyToMessageId) } as unknown as Record<string, unknown>)
      : undefined;

    try {
      const data = attachment.data;
      const isImage = attachment.type === 'image' || attachment.type === 'photo';

      // If data is a URL string, send it directly
      if (typeof data === 'string' && (data.startsWith('http://') || data.startsWith('https://'))) {
        if (isImage) {
          await (this.bot.telegram.sendPhoto as (...args: unknown[]) => Promise<unknown>)(
            chatId,
            data,
            replyExtra
          );
        } else {
          await (this.bot.telegram.sendDocument as (...args: unknown[]) => Promise<unknown>)(
            chatId,
            data,
            replyExtra
          );
        }
        return;
      }

      // If data is a base64 string, convert to buffer and send
      if (typeof data === 'string') {
        let buffer: Buffer;
        if (data.startsWith('data:')) {
          const base64Index = data.indexOf('base64,');
          if (base64Index !== -1) {
            buffer = Buffer.from(data.slice(base64Index + 7), 'base64');
          } else {
            return;
          }
        } else {
          buffer = Buffer.from(data, 'base64');
        }

        const filename = attachment.name ?? 'attachment';
        if (isImage) {
          await (this.bot.telegram.sendPhoto as (...args: unknown[]) => Promise<unknown>)(
            chatId,
            { source: buffer, filename },
            replyExtra
          );
        } else {
          await (this.bot.telegram.sendDocument as (...args: unknown[]) => Promise<unknown>)(
            chatId,
            { source: buffer, filename },
            replyExtra
          );
        }
      }
    } catch (error) {
      logger.warn(
        { chatId, attachmentType: attachment.type, err: error },
        'Failed to send attachment'
      );
    }
  }

  async healthCheck(): Promise<HealthStatusType> {
    if (!this.bot) return 'unhealthy';
    return 'healthy';
  }

  /**
   * Handle incoming text messages.
   */
  private async handleMessage(ctx: unknown): Promise<void> {
    if (!this.config || !this.bot) return;
    if (!ctx || typeof ctx !== 'object' || !('message' in ctx)) return;

    const message = (ctx as { message?: Record<string, unknown> }).message;
    if (!message || typeof message !== 'object' || !('text' in message)) return;

    const chat = message.chat as { id?: number; type?: string } | undefined;
    const from = message.from as { id?: number } | undefined;
    const text = typeof message.text === 'string' ? message.text : '';
    const messageId =
      typeof message.message_id === 'number' || typeof message.message_id === 'string'
        ? String(message.message_id)
        : undefined;
    if (!chat || typeof chat.type !== 'string' || typeof chat.id !== 'number') return;
    if (!from || typeof from.id !== 'number') return;
    if (!messageId) return;

    const conversationId = String(chat.id);
    const userId = String(from.id);
    const isDm = chat.type === 'private';

    const allowed = await this.checkMessagePolicy(conversationId, userId, text, isDm);
    if (!allowed) return;

    // Send typing indicator while processing
    await this.bot.telegram.sendChatAction(chat.id, 'typing').catch(() => {
      // Non-fatal
    });

    const inbound = {
      channel: this.channelId,
      channelMessageId: messageId,
      sender: {
        id: userId,
        isAllowed: true,
      },
      conversation: {
        id: conversationId,
        type: isDm ? 'dm' : 'channel',
      },
      content: {
        text,
      },
      metadata: {
        chatType: chat.type,
      },
    };

    const validation = validateChannelInboundMessage(inbound);
    if (!validation.success) {
      logger.warn({ errors: validation.errors }, 'Dropping invalid inbound message');
      return;
    }

    await this.config.bus.publish(TOPICS.channel.inbound(this.channelId), inbound);
  }

  /**
   * Handle incoming media messages (photo, document, video, audio, voice, sticker).
   */
  private async handleMediaMessage(ctx: unknown, mediaType: string): Promise<void> {
    if (!this.config || !this.bot) return;
    if (!ctx || typeof ctx !== 'object' || !('message' in ctx)) return;

    const message = (ctx as { message?: Record<string, unknown> }).message;
    if (!message || typeof message !== 'object') return;

    const chat = message.chat as { id?: number; type?: string } | undefined;
    const from = message.from as { id?: number } | undefined;
    const messageId =
      typeof message.message_id === 'number' || typeof message.message_id === 'string'
        ? String(message.message_id)
        : undefined;
    if (!chat || typeof chat.type !== 'string' || typeof chat.id !== 'number') return;
    if (!from || typeof from.id !== 'number') return;
    if (!messageId) return;

    const conversationId = String(chat.id);
    const userId = String(from.id);
    const isDm = chat.type === 'private';
    const caption = typeof message.caption === 'string' ? message.caption : '';

    const allowed = await this.checkMessagePolicy(conversationId, userId, caption, isDm);
    if (!allowed) return;

    // Send typing indicator while processing
    await this.bot.telegram.sendChatAction(chat.id, 'typing').catch(() => {
      // Non-fatal
    });

    // Extract file_id based on media type
    const fileId = this.extractFileId(message, mediaType);
    if (!fileId) {
      logger.warn({ mediaType, messageId }, 'Could not extract file_id from media message');
      return;
    }

    // Get file info and URL from Telegram
    let fileUrl: string | undefined;
    let fileName: string | undefined;
    let fileSize: number | undefined;

    try {
      const file = await this.bot.telegram.getFile(fileId);
      if (file.file_path) {
        const token =
          (this.config.config as TelegramChannelConfig).token ??
          this.config.secrets.TELEGRAM_BOT_TOKEN;
        fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      }
      fileSize = file.file_size;
      // Extract filename from file_path if available
      if (file.file_path) {
        const pathParts = file.file_path.split('/');
        fileName = pathParts[pathParts.length - 1];
      }
    } catch (error) {
      logger.warn({ fileId, mediaType, err: error }, 'Failed to get file info from Telegram');
    }

    // Try to extract mime_type from media-specific fields
    const mimeType = this.extractMimeType(message, mediaType);
    // Try to get a better filename from the document
    if (mediaType === 'document') {
      const doc = message.document as { file_name?: string } | undefined;
      if (doc?.file_name) {
        fileName = doc.file_name;
      }
    }

    const attachmentType = MEDIA_TYPE_MAP[mediaType] ?? 'file';
    const attachments = fileUrl
      ? [
          {
            type: attachmentType,
            url: fileUrl,
            name: fileName,
            mimeType,
            size: fileSize,
          },
        ]
      : undefined;

    const textContent = caption || `[${mediaType}]`;

    const inbound = {
      channel: this.channelId,
      channelMessageId: messageId,
      sender: {
        id: userId,
        isAllowed: true,
      },
      conversation: {
        id: conversationId,
        type: isDm ? 'dm' : 'channel',
      },
      content: {
        text: textContent,
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
      },
      metadata: {
        chatType: chat.type,
        mediaType,
      },
    };

    const validation = validateChannelInboundMessage(inbound);
    if (!validation.success) {
      logger.warn({ errors: validation.errors }, 'Dropping invalid inbound media message');
      return;
    }

    await this.config.bus.publish(TOPICS.channel.inbound(this.channelId), inbound);
  }

  /**
   * Extract the file_id from a Telegram message based on the media type.
   */
  private extractFileId(message: Record<string, unknown>, mediaType: string): string | undefined {
    switch (mediaType) {
      case 'photo': {
        // photo is an array of PhotoSize, pick the largest (last)
        const photos = message.photo as Array<{ file_id?: string }> | undefined;
        if (!photos || photos.length === 0) return undefined;
        const largest = photos[photos.length - 1];
        return largest?.file_id;
      }
      case 'document': {
        const doc = message.document as { file_id?: string } | undefined;
        return doc?.file_id;
      }
      case 'video': {
        const video = message.video as { file_id?: string } | undefined;
        return video?.file_id;
      }
      case 'audio': {
        const audio = message.audio as { file_id?: string } | undefined;
        return audio?.file_id;
      }
      case 'voice': {
        const voice = message.voice as { file_id?: string } | undefined;
        return voice?.file_id;
      }
      case 'sticker': {
        const sticker = message.sticker as { file_id?: string } | undefined;
        return sticker?.file_id;
      }
      default:
        return undefined;
    }
  }

  /**
   * Extract MIME type from a Telegram message based on the media type.
   */
  private extractMimeType(message: Record<string, unknown>, mediaType: string): string | undefined {
    switch (mediaType) {
      case 'document': {
        const doc = message.document as { mime_type?: string } | undefined;
        return doc?.mime_type;
      }
      case 'video': {
        const video = message.video as { mime_type?: string } | undefined;
        return video?.mime_type;
      }
      case 'audio': {
        const audio = message.audio as { mime_type?: string } | undefined;
        return audio?.mime_type;
      }
      case 'voice': {
        const voice = message.voice as { mime_type?: string } | undefined;
        return voice?.mime_type;
      }
      case 'sticker': {
        // Stickers are typically webp
        return 'image/webp';
      }
      case 'photo':
        return 'image/jpeg';
      default:
        return undefined;
    }
  }

  /**
   * Shared policy checking logic for text and media messages.
   * Returns true if the message is allowed, false otherwise.
   * Handles pairing and DM/group policy checks.
   */
  private async checkMessagePolicy(
    conversationId: string,
    userId: string,
    text: string,
    isDm: boolean
  ): Promise<boolean> {
    if (!this.config) return false;

    const channelConfig = this.config.config as TelegramChannelConfig;

    if (isDm) {
      const dmPolicy = resolveDmPolicy(channelConfig.dm) ?? this.config.dmPolicy;
      if (!dmPolicy) return false;

      if (dmPolicy.pairing) {
        const command = parsePairingCommand(text);
        if (command) {
          if (this.pairingToken && command.token !== this.pairingToken) {
            await this.sendMessage({
              channel: this.channelId,
              conversationId,
              content: { text: 'Pairing token invalid.' },
            });
            return false;
          }
          await this.pairingStore.setPaired(userId);
          await this.sendMessage({
            channel: this.channelId,
            conversationId,
            content: { text: 'Pairing successful. You can now message the assistant.' },
          });
          return false;
        }
      }
      const allowed = await shouldAllowDm(
        userId,
        dmPolicy.userAllowlist,
        dmPolicy.pairing ?? false,
        async (id) => this.pairingStore.isPaired(id)
      );
      if (!allowed) return false;
    } else {
      const serverConfig = findServerConfig(channelConfig.servers, conversationId);
      if (!serverConfig) return false;
      const groupPolicy = resolveGroupPolicy(serverConfig);
      const mentionPatterns = this.botUsername ? [`@${this.botUsername}`] : [];
      const allowed = shouldAllowGroupMessage({
        channelId: conversationId,
        userId,
        text,
        channelAllowlist: groupPolicy.channelIds,
        userAllowlist: groupPolicy.userAllowlist,
        mentionGating: groupPolicy.mentionGating,
        mentionPatterns,
      });
      if (!allowed) return false;
    }

    return true;
  }
}
