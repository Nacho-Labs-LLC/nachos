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
import { shouldAllowDm, shouldAllowGroupMessage } from '@nachos/utils';

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

  async initialize(config: ChannelAdapterConfig): Promise<void> {
    this.config = config;
    const channelConfig = config.config as TelegramChannelConfig;
    const token = channelConfig.token ?? config.secrets.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('Telegram token is required');
    }

    this.bot = new Telegraf(token);
    this.bot.on('text', async (ctx) => {
      await this.handleMessage(ctx);
    });
  }

  async start(): Promise<void> {
    if (!this.bot || !this.config) {
      throw new Error('Telegram adapter not initialized');
    }

    const me = await this.bot.telegram.getMe();
    this.botUsername = me.username ?? undefined;

    await this.bot.launch();

    await this.config.bus.subscribe(
      TOPICS.channel.outbound(this.channelId),
      async (payload) => {
        await this.sendMessage(payload as OutboundMessage);
      }
    );
  }

  async stop(): Promise<void> {
    await this.bot?.stop();
  }

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    if (!this.bot) {
      throw new Error('Telegram adapter not initialized');
    }

    try {
      const replyOptions = message.replyToMessageId
        ? ({ reply_to_message_id: Number(message.replyToMessageId) } as unknown as Parameters<
            typeof this.bot.telegram.sendMessage
          >[2])
        : undefined;

      const response = await this.bot.telegram.sendMessage(
        Number(message.conversationId),
        message.content.text,
        replyOptions
      );

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

  async healthCheck(): Promise<HealthStatusType> {
    if (!this.bot) return 'unhealthy';
    return 'healthy';
  }

  private async handleMessage(ctx: any): Promise<void> {
    if (!this.config || !this.bot) return;
    if (!('message' in ctx) || !ctx.message || !('text' in ctx.message)) return;

    const channelConfig = this.config.config as TelegramChannelConfig;
    const chat = ctx.message.chat;
    const from = ctx.message.from;
    if (!from) return;

    const isDm = chat.type === 'private';
    const conversationId = String(chat.id);
    const userId = String(from.id);

    if (isDm) {
      const dmPolicy = resolveDmPolicy(channelConfig.dm) ?? this.config.dmPolicy;
      if (!dmPolicy) return;

      if (dmPolicy.pairing) {
        const command = parsePairingCommand(ctx.message.text ?? '');
        if (command) {
          if (this.pairingToken && command.token !== this.pairingToken) {
            await this.sendMessage({
              channel: this.channelId,
              conversationId,
              content: { text: 'Pairing token invalid.' },
            });
            return;
          }
          await this.pairingStore.setPaired(userId);
          await this.sendMessage({
            channel: this.channelId,
            conversationId,
            content: { text: 'Pairing successful. You can now message the assistant.' },
          });
          return;
        }
      }
      const allowed = await shouldAllowDm(
        userId,
        dmPolicy.userAllowlist,
        dmPolicy.pairing ?? false,
        async (id) => this.pairingStore.isPaired(id)
      );
      if (!allowed) return;
    } else {
      const serverConfig = findServerConfig(channelConfig.servers, conversationId);
      if (!serverConfig) return;
      const groupPolicy = resolveGroupPolicy(serverConfig);
      const mentionPatterns = this.botUsername ? [`@${this.botUsername}`] : [];
      const allowed = shouldAllowGroupMessage({
        channelId: conversationId,
        userId,
        text: ctx.message.text ?? '',
        channelAllowlist: groupPolicy.channelIds,
        userAllowlist: groupPolicy.userAllowlist,
        mentionGating: groupPolicy.mentionGating,
        mentionPatterns,
      });
      if (!allowed) return;
    }

    const inbound = {
      channel: this.channelId,
      channelMessageId: String(ctx.message.message_id),
      sender: {
        id: userId,
        isAllowed: true,
      },
      conversation: {
        id: conversationId,
        type: isDm ? 'dm' : 'channel',
      },
      content: {
        text: ctx.message.text ?? '',
      },
      metadata: {
        chatType: chat.type,
      },
    };

    await this.config.bus.publish(TOPICS.channel.inbound(this.channelId), inbound);
  }
}
